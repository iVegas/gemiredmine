# AI agents: the MCP endpoint

The desktop app can run a local endpoint that AI agents connect to, using the
[Model Context Protocol](https://modelcontextprotocol.io). An agent can then read the Redmine servers you added, your
assigned tasks, the details of a task, and the time logged on it. It cannot change anything in Redmine yet.

## Turn it on

Open **Settings > AI agents** and tick **Let AI agents connect on this computer**. The endpoint runs at
`http://127.0.0.1:47831/mcp`. If that port is in use, change it in the same section. Each installed channel (stable,
canary, unstable, dev) can use its own port.

The app must be running. The endpoint lives in the app's main window.

## Connect an agent

Copy the token from **Settings > AI agents** (Show, then Copy token). Then, for Claude Code:

```sh
claude mcp add --transport http gemiredmine http://127.0.0.1:47831/mcp --header "Authorization: Bearer <token>"
```

The settings page shows this command, with the token filled in once you click Show. Any MCP client that supports the Streamable HTTP
transport and a bearer token can connect the same way.

Keep the token secret. Anyone who has it can read your tasks through the app. The token is kept in the system's
credential store, and it stays the same until it is removed from there.

## What an agent can do

Every tool reads. None of them changes Redmine.

| Tool | Arguments | Answer |
| --- | --- | --- |
| `list_servers` | none | The servers you added, whether you are signed in to each, and which one the app shows |
| `list_assigned_tasks` | `server` (optional) | The open tasks assigned to you on that server, up to 100 |
| `get_task` | `server` (optional), `taskId` | One task in full: description, people, estimate, time spent, dates |
| `list_task_time` | `server` (optional), `taskId` | The time logged on a task, with the total hours |

A server is named by its id or its name. Without one, the server the app shows is used. An agent that asks for a server
you are not signed in to is told so, and is asked to sign in to it in the app.

## Safety

- The endpoint listens on 127.0.0.1 only, so no other computer can reach it.
- A request must carry the token, must name `localhost` or `127.0.0.1` as its host, and must not come from a web page.
  A web page that tries to reach the endpoint is refused even with the token.
- Your API keys never leave the app. The tools answer with the data of a task, never with a key.
- A long description is cut at 4000 characters, and a list at 100 items, so an answer stays small.

## Limits

- Desktop only: Windows and Linux. Android has no endpoint.
- Read only. Logging time or changing a task needs an approval step in the app first, which is not built yet.
- The token cannot be replaced from the settings yet. Removing it from the credential store makes a new one on the next
  start, and every agent must then be given the new token.
- Turning the endpoint off stops it, but does not revoke the token.

## How it is built

The request arrives over HTTP in the desktop shell (`src-tauri/src/mcp.rs`), which checks it and passes it to the main
window as an event. The window answers it from the servers in its store (`src/mainview/lib/mcp-host.ts`), using the
message handler in `src/bun/mcp/`. The handler knows nothing about the platform, so its tests run without the app.
