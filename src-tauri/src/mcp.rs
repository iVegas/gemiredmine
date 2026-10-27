//! The local endpoint that AI agents connect to, over MCP (the Model Context Protocol, Streamable HTTP transport).
//!
//! It listens on 127.0.0.1 only, and every request must carry the bearer token from the credential store. It knows
//! nothing about Redmine: a request is passed to the webview as an event, and the webview answers it with
//! `mcp_respond`. The servers and their API keys are in the webview, so they never reach this module.

use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tiny_http::{Header, Method, Request, Response, Server};

/// The one path the endpoint answers.
pub const ENDPOINT: &str = "/mcp";
/// The largest request body that is read. A tool call is a few hundred bytes.
pub const MAX_BODY_BYTES: u64 = 1024 * 1024;
/// How long a request waits for the webview. Reading a task from Redmine takes seconds at most.
pub const ANSWER_TIMEOUT: Duration = Duration::from_secs(30);
/// The event that carries a request to the webview.
pub const REQUEST_EVENT: &str = "mcp-request";

/// What the webview receives: the id to answer with `mcp_respond`, and the JSON-RPC message as it was sent.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Forwarded {
    id: u64,
    body: String,
}

/// The requests that wait for the webview's answer, by id.
#[derive(Default)]
pub struct Bridge {
    next_id: AtomicU64,
    waiting: Mutex<HashMap<u64, Sender<String>>>,
}

impl Bridge {
    /// Starts a request: its id, and the receiver its answer comes back on.
    pub fn begin(&self) -> (u64, Receiver<String>) {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = mpsc::channel();
        self.lock().insert(id, sender);
        (id, receiver)
    }

    /// Hands the webview's answer to the request that waits for it. False when no request is waiting, such as one
    /// that has already timed out.
    pub fn respond(&self, id: u64, body: String) -> bool {
        match self.lock().remove(&id) {
            Some(sender) => sender.send(body).is_ok(),
            None => false,
        }
    }

    /// Forgets a request that will not be answered.
    pub fn cancel(&self, id: u64) {
        self.lock().remove(&id);
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<u64, Sender<String>>> {
        self.waiting
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// What a request looks like before its body is read.
pub struct Head<'a> {
    pub method: &'a Method,
    /// The path without its query string.
    pub path: &'a str,
    pub host: Option<&'a str>,
    pub origin: Option<&'a str>,
    pub authorization: Option<&'a str>,
}

/// Why a request is refused: the HTTP status, and a sentence for the caller.
#[derive(Debug, PartialEq, Eq)]
pub struct Refusal {
    pub status: u16,
    pub message: &'static str,
}

/// Decides whether a request may reach the webview. The checks run before the body is read, so a stranger costs
/// nothing.
///
/// - Only POST to `/mcp`. The endpoint does not stream, so GET is not offered.
/// - The Host must be this endpoint's own address. A web page that rebinds a domain to 127.0.0.1 sends another Host.
/// - No Origin. Browsers send one on cross-site requests; the agents this is for do not.
/// - The bearer token from the credential store, compared without stopping at the first wrong byte.
pub fn admit(head: &Head, port: u16, token: &str) -> Result<(), Refusal> {
    if head.path != ENDPOINT {
        return Err(Refusal {
            status: 404,
            message: "There is no such endpoint. The MCP endpoint is /mcp.",
        });
    }
    if !matches!(head.method, Method::Post) {
        return Err(Refusal {
            status: 405,
            message: "Only POST is accepted.",
        });
    }
    let own = [format!("127.0.0.1:{port}"), format!("localhost:{port}")];
    match head.host {
        Some(host) if own.iter().any(|address| address == host) => {}
        _ => {
            return Err(Refusal {
                status: 403,
                message: "Only requests to 127.0.0.1 or localhost are accepted.",
            });
        }
    }
    if head.origin.is_some() {
        return Err(Refusal {
            status: 403,
            message: "Requests from a web page are not accepted.",
        });
    }
    match head
        .authorization
        .and_then(|value| value.strip_prefix("Bearer "))
    {
        Some(given) if constant_time_eq(given.as_bytes(), token.as_bytes()) => Ok(()),
        _ => Err(Refusal {
            status: 401,
            message: "The bearer token is missing or wrong.",
        }),
    }
}

/// Compares two secrets without stopping at the first byte that differs. Only the length is revealed.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |diff, (x, y)| diff | (x ^ y)) == 0
}

/// A running endpoint. Dropping it stops listening; requests already waiting for the webview finish on their own.
pub struct Endpoint {
    port: u16,
    server: Arc<Server>,
    thread: Option<JoinHandle<()>>,
}

impl Endpoint {
    pub fn port(&self) -> u16 {
        self.port
    }
}

impl Drop for Endpoint {
    fn drop(&mut self) {
        self.server.unblock();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// Hands a request to the webview. False when the webview cannot receive it.
pub type Forward = Arc<dyn Fn(Forwarded) -> bool + Send + Sync>;

/// Starts listening on 127.0.0.1 at `port`. Fails when the port is taken.
pub fn start(
    app: AppHandle,
    bridge: Arc<Bridge>,
    token: String,
    port: u16,
) -> Result<Endpoint, String> {
    let server = Server::http(("127.0.0.1", port))
        .map_err(|error| format!("Port {port} is not free for the MCP endpoint: {error}"))?;
    let forward: Forward =
        Arc::new(move |payload| app.emit_to("main", REQUEST_EVENT, payload).is_ok());
    Ok(serve(server, bridge, token, port, ANSWER_TIMEOUT, forward))
}

/// Answers the requests that reach `server`. Each one is checked, handed to `forward`, and answered with what the webview
/// replies, or with a refusal.
pub fn serve(
    server: Server,
    bridge: Arc<Bridge>,
    token: String,
    port: u16,
    timeout: Duration,
    forward: Forward,
) -> Endpoint {
    let server = Arc::new(server);
    let accepting = Arc::clone(&server);
    let thread = std::thread::spawn(move || {
        for request in accepting.incoming_requests() {
            let (bridge, token, forward) =
                (Arc::clone(&bridge), token.clone(), Arc::clone(&forward));
            // One thread per request: a slow answer from the webview must not hold up the next request.
            std::thread::spawn(move || answer(request, &forward, &bridge, &token, port, timeout));
        }
    });
    Endpoint {
        port,
        server,
        thread: Some(thread),
    }
}

fn header(request: &Request, name: &'static str) -> Option<String> {
    request
        .headers()
        .iter()
        .find(|field| field.field.equiv(name))
        .map(|field| field.value.as_str().to_string())
}

fn answer(
    mut request: Request,
    forward: &Forward,
    bridge: &Bridge,
    token: &str,
    port: u16,
    timeout: Duration,
) {
    let host = header(&request, "Host");
    let origin = header(&request, "Origin");
    let authorization = header(&request, "Authorization");
    let path = request.url().split('?').next().unwrap_or("").to_string();
    let head = Head {
        method: request.method(),
        path: &path,
        host: host.as_deref(),
        origin: origin.as_deref(),
        authorization: authorization.as_deref(),
    };
    if let Err(refusal) = admit(&head, port, token) {
        return send(
            request,
            refusal.status,
            "text/plain",
            refusal.message.to_string(),
        );
    }

    let mut body = String::new();
    let read = request
        .as_reader()
        .take(MAX_BODY_BYTES + 1)
        .read_to_string(&mut body);
    match read {
        Ok(_) if body.len() as u64 > MAX_BODY_BYTES => {
            return send(
                request,
                413,
                "text/plain",
                "The request is too large.".to_string(),
            );
        }
        Ok(_) => {}
        Err(_) => {
            return send(
                request,
                400,
                "text/plain",
                "The request body could not be read.".to_string(),
            );
        }
    }

    let (id, answer) = bridge.begin();
    if !forward(Forwarded { id, body }) {
        bridge.cancel(id);
        return send(
            request,
            503,
            "text/plain",
            "The app window is not ready for MCP requests.".to_string(),
        );
    }
    match answer.recv_timeout(timeout) {
        // An empty answer is a notification: the request has no reply.
        Ok(reply) if reply.is_empty() => send(request, 202, "application/json", String::new()),
        Ok(reply) => send(request, 200, "application/json", reply),
        Err(_) => {
            bridge.cancel(id);
            send(
                request,
                504,
                "application/json",
                r#"{"jsonrpc":"2.0","id":null,"error":{"code":-32001,"message":"The app did not answer in time."}}"#
                    .to_string(),
            )
        }
    }
}

fn send(request: Request, status: u16, content_type: &str, body: String) {
    let mut response = Response::from_string(body).with_status_code(status);
    if let Ok(header) = Header::from_bytes(&b"Content-Type"[..], content_type.as_bytes()) {
        response.add_header(header);
    }
    // A 401 names the scheme the endpoint wants, so that an agent knows what to send.
    if let (401, Ok(header)) = (
        status,
        Header::from_bytes(&b"WWW-Authenticate"[..], &b"Bearer"[..]),
    ) {
        response.add_header(header);
    }
    // The client has gone away when a reply cannot be written; there is nobody left to tell.
    let _ = request.respond(response);
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";
    const PORT: u16 = 47831;

    fn head<'a>(
        method: &'a Method,
        path: &'a str,
        host: Option<&'a str>,
        origin: Option<&'a str>,
        auth: Option<&'a str>,
    ) -> Head<'a> {
        Head {
            method,
            path,
            host,
            origin,
            authorization: auth,
        }
    }

    fn refused(head: &Head) -> u16 {
        admit(head, PORT, TOKEN).expect_err("refused").status
    }

    #[test]
    fn admits_a_post_from_this_machine_with_the_token() {
        let auth = format!("Bearer {TOKEN}");
        let head = head(
            &Method::Post,
            "/mcp",
            Some("127.0.0.1:47831"),
            None,
            Some(&auth),
        );

        assert_eq!(admit(&head, PORT, TOKEN), Ok(()));
    }

    #[test]
    fn accepts_localhost_as_the_host_name() {
        let auth = format!("Bearer {TOKEN}");

        assert!(
            admit(
                &head(
                    &Method::Post,
                    "/mcp",
                    Some("localhost:47831"),
                    None,
                    Some(&auth)
                ),
                PORT,
                TOKEN
            )
            .is_ok()
        );
    }

    #[test]
    fn refuses_other_paths_and_methods_before_looking_at_anything_else() {
        let auth = format!("Bearer {TOKEN}");

        assert_eq!(
            refused(&head(
                &Method::Post,
                "/other",
                Some("127.0.0.1:47831"),
                None,
                Some(&auth)
            )),
            404
        );
        assert_eq!(
            refused(&head(
                &Method::Get,
                "/mcp",
                Some("127.0.0.1:47831"),
                None,
                Some(&auth)
            )),
            405
        );
    }

    #[test]
    fn refuses_a_host_that_is_not_this_endpoint() {
        // A web page that rebinds a domain to 127.0.0.1 sends its own name as the Host.
        let auth = format!("Bearer {TOKEN}");

        assert_eq!(
            refused(&head(
                &Method::Post,
                "/mcp",
                Some("evil.example:47831"),
                None,
                Some(&auth)
            )),
            403
        );
        assert_eq!(
            refused(&head(
                &Method::Post,
                "/mcp",
                Some("127.0.0.1:9999"),
                None,
                Some(&auth)
            )),
            403
        );
        assert_eq!(
            refused(&head(&Method::Post, "/mcp", None, None, Some(&auth))),
            403
        );
    }

    #[test]
    fn refuses_any_request_that_comes_from_a_web_page() {
        let auth = format!("Bearer {TOKEN}");

        assert_eq!(
            refused(&head(
                &Method::Post,
                "/mcp",
                Some("127.0.0.1:47831"),
                Some("http://localhost:3000"),
                Some(&auth)
            )),
            403
        );
    }

    #[test]
    fn refuses_a_missing_or_wrong_token() {
        let wrong = format!("Bearer {}", "f".repeat(32));

        assert_eq!(
            refused(&head(
                &Method::Post,
                "/mcp",
                Some("127.0.0.1:47831"),
                None,
                None
            )),
            401
        );
        assert_eq!(
            refused(&head(
                &Method::Post,
                "/mcp",
                Some("127.0.0.1:47831"),
                None,
                Some(&wrong)
            )),
            401
        );
        assert_eq!(
            refused(&head(
                &Method::Post,
                "/mcp",
                Some("127.0.0.1:47831"),
                None,
                Some(TOKEN)
            )),
            401
        );
        assert_eq!(
            refused(&head(
                &Method::Post,
                "/mcp",
                Some("127.0.0.1:47831"),
                None,
                Some("Bearer ")
            )),
            401
        );
    }

    #[test]
    fn compares_secrets_by_length_and_every_byte() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"ab"));
        assert!(!constant_time_eq(b"", b"a"));
    }

    #[test]
    fn a_waiting_request_gets_the_answer_for_its_id_once() {
        let bridge = Bridge::default();
        let (first, first_answer) = bridge.begin();
        let (second, second_answer) = bridge.begin();

        assert!(bridge.respond(second, "two".to_string()));
        assert!(
            !bridge.respond(second, "again".to_string()),
            "an answer is taken once"
        );
        assert!(bridge.respond(first, "one".to_string()));

        assert_eq!(second_answer.recv().unwrap(), "two");
        assert_eq!(first_answer.recv().unwrap(), "one");
    }

    /// Starts an endpoint on a free port, with a webview that answers each request with `reply`.
    fn endpoint_answering(
        reply: fn(Forwarded, &Bridge) -> bool,
        timeout: Duration,
    ) -> (Endpoint, Arc<Bridge>) {
        let server = Server::http(("127.0.0.1", 0)).expect("a free port");
        let port = server.server_addr().to_ip().expect("an IP address").port();
        let bridge = Arc::new(Bridge::default());
        let for_webview = Arc::clone(&bridge);
        let forward: Forward = Arc::new(move |payload| reply(payload, &for_webview));
        (
            serve(
                server,
                Arc::clone(&bridge),
                TOKEN.to_string(),
                port,
                timeout,
                forward,
            ),
            bridge,
        )
    }

    /// Sends one request over a socket and returns the status line and the body of the answer.
    fn post(
        port: u16,
        auth: Option<&str>,
        origin: Option<&str>,
        body: &str,
    ) -> (u16, String, String) {
        use std::io::{Read as _, Write as _};
        use std::net::TcpStream;

        let mut head = format!(
            "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Length: {}\r\nConnection: close\r\n",
            body.len()
        );
        if let Some(auth) = auth {
            head.push_str(&format!("Authorization: {auth}\r\n"));
        }
        if let Some(origin) = origin {
            head.push_str(&format!("Origin: {origin}\r\n"));
        }
        head.push_str("\r\n");

        let mut stream =
            TcpStream::connect(("127.0.0.1", port)).expect("the endpoint accepts connections");
        stream.write_all(head.as_bytes()).unwrap();
        stream.write_all(body.as_bytes()).unwrap();
        let mut answer = String::new();
        stream.read_to_string(&mut answer).unwrap();

        let status = answer.split(' ').nth(1).unwrap().parse().unwrap();
        let headers = answer.split("\r\n\r\n").next().unwrap().to_string();
        let body = answer.split("\r\n\r\n").nth(1).unwrap_or("").to_string();
        (status, headers, body)
    }

    fn echo(payload: Forwarded, bridge: &Bridge) -> bool {
        bridge.respond(payload.id, format!("echo {}", payload.body))
    }

    #[test]
    fn a_request_with_the_token_reaches_the_webview_and_gets_its_answer() {
        let (endpoint, _bridge) = endpoint_answering(echo, Duration::from_secs(5));
        let auth = format!("Bearer {TOKEN}");

        let (status, _, body) = post(
            endpoint.port(),
            Some(&auth),
            None,
            r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#,
        );

        assert_eq!(status, 200);
        assert_eq!(body, r#"echo {"jsonrpc":"2.0","id":1,"method":"ping"}"#);
    }

    #[test]
    fn a_request_without_the_token_never_reaches_the_webview() {
        let reached = Arc::new(Mutex::new(0));
        let counter = Arc::clone(&reached);
        let forward: Forward = Arc::new(move |_| {
            *counter.lock().unwrap() += 1;
            true
        });
        let server = Server::http(("127.0.0.1", 0)).expect("a free port");
        let port = server.server_addr().to_ip().unwrap().port();
        let _endpoint = serve(
            server,
            Arc::new(Bridge::default()),
            TOKEN.to_string(),
            port,
            Duration::from_secs(5),
            forward,
        );

        let (status, headers, _) = post(port, None, None, "{}");

        assert_eq!(status, 401);
        assert!(headers.contains("WWW-Authenticate: Bearer"));
        assert_eq!(*reached.lock().unwrap(), 0);
    }

    #[test]
    fn a_notification_gets_no_reply() {
        let (endpoint, _bridge) = endpoint_answering(
            |payload, bridge| bridge.respond(payload.id, String::new()),
            Duration::from_secs(5),
        );
        let auth = format!("Bearer {TOKEN}");

        let (status, _, body) = post(
            endpoint.port(),
            Some(&auth),
            None,
            r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
        );

        assert_eq!(status, 202);
        assert_eq!(body, "");
    }

    #[test]
    fn a_web_page_is_refused_even_with_the_token() {
        let (endpoint, _bridge) = endpoint_answering(echo, Duration::from_secs(5));
        let auth = format!("Bearer {TOKEN}");

        let (status, _, _) = post(
            endpoint.port(),
            Some(&auth),
            Some("http://localhost:3000"),
            "{}",
        );

        assert_eq!(status, 403);
    }

    #[test]
    fn a_webview_that_does_not_answer_in_time_ends_the_request() {
        let (endpoint, _bridge) = endpoint_answering(|_, _| true, Duration::from_millis(200));
        let auth = format!("Bearer {TOKEN}");

        let (status, _, body) = post(endpoint.port(), Some(&auth), None, "{}");

        assert_eq!(status, 504);
        assert!(body.contains("did not answer in time"));
    }

    #[test]
    fn a_webview_that_cannot_receive_requests_is_reported_as_unavailable() {
        let (endpoint, _bridge) = endpoint_answering(|_, _| false, Duration::from_secs(5));
        let auth = format!("Bearer {TOKEN}");

        let (status, _, _) = post(endpoint.port(), Some(&auth), None, "{}");

        assert_eq!(status, 503);
    }

    #[test]
    fn an_answer_to_a_request_that_was_cancelled_is_refused() {
        let bridge = Bridge::default();
        let (id, _answer) = bridge.begin();
        bridge.cancel(id);

        assert!(!bridge.respond(id, "late".to_string()));
    }
}
