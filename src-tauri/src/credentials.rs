//! The API keys of the user's Redmine servers, kept in the system's credential store (Windows Credential
//! Manager, the Secret Service on Linux) instead of in a file. The webview asks for them by server id and holds
//! them in memory only while it runs.
//!
//! Where there is no credential store, or it cannot be reached (no Secret Service on a minimal Linux desktop, a
//! locked keyring that is not unlocked), every call fails with a message the user can read, and the app carries
//! on without remembering anyone.

use std::sync::{Arc, Mutex};

use keyring_core::{CredentialStore, Entry, Error};

/// A Redmine API key has 40 characters. The limit keeps a mistake from filling the store.
const MAX_TOKEN_LEN: usize = 1024;

/// What the webview calls a server: its id, which is a UUID. Anything else is refused, so a request cannot
/// name an entry of some other kind.
fn valid_server_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn describe(error: Error) -> String {
    format!("The system's credential store did not accept the request: {error}")
}

/// The text the Secret Service gives when it refuses the session key of a connection. secret-service 5.2 sends the
/// client's public key without padding, so a key whose leading byte is zero (about one in 256) is one byte short.
/// Every connection makes a new key, so trying again nearly always works.
#[cfg(any(target_os = "linux", test))]
const KEY_SIZE_REFUSED: &str = "Client public key size is invalid";

/// How many connections to make when the Secret Service refuses the key. Each try fails with probability 1/256 or so,
/// so five in a row is not worth designing for.
#[cfg(any(target_os = "linux", test))]
const SESSION_ATTEMPTS: usize = 5;

/// Runs `open` until it succeeds, it fails with an error that `retryable` does not accept, or `attempts` tries are
/// used up. The last error is returned.
#[cfg(any(target_os = "linux", test))]
fn retry_session<T, E>(
    attempts: usize,
    mut open: impl FnMut() -> Result<T, E>,
    retryable: impl Fn(&E) -> bool,
) -> Result<T, E> {
    let mut tries = 1;
    loop {
        match open() {
            Err(error) if tries < attempts && retryable(&error) => tries += 1,
            result => return result,
        }
    }
}

/// Opens the credential store of this system.
#[cfg(target_os = "linux")]
pub fn native_store() -> Result<Arc<CredentialStore>, String> {
    let store = retry_session(
        SESSION_ATTEMPTS,
        zbus_secret_service_keyring_store::Store::new,
        |error| error.to_string().contains(KEY_SIZE_REFUSED),
    )
    .map_err(|error| {
        format!("The system's credential store (the Secret Service) could not be reached: {error}")
    })?;
    Ok(store)
}

#[cfg(target_os = "windows")]
pub fn native_store() -> Result<Arc<CredentialStore>, String> {
    let store = windows_native_keyring_store::Store::new().map_err(|error| {
        format!("The system's credential store (Credential Manager) could not be used: {error}")
    })?;
    Ok(store)
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
pub fn native_store() -> Result<Arc<CredentialStore>, String> {
    Err("This system has no credential store that the app can use yet.".to_string())
}

type OpenStore = dyn Fn() -> Result<Arc<CredentialStore>, String> + Send + Sync;

/// The credentials of one channel of the app. `service` names the channel (its identifier), so channels that are
/// installed side by side never see each other's keys.
pub struct Credentials {
    service: String,
    open: Box<OpenStore>,
    /// The store, once it has been opened. A store that could not be opened is tried again at the next call, because
    /// the user may start the keyring in the meantime.
    store: Mutex<Option<Arc<CredentialStore>>>,
}

impl Credentials {
    pub fn new(
        service: impl Into<String>,
        open: impl Fn() -> Result<Arc<CredentialStore>, String> + Send + Sync + 'static,
    ) -> Self {
        Credentials {
            service: service.into(),
            open: Box::new(open),
            store: Mutex::new(None),
        }
    }

    fn entry(&self, server_id: &str) -> Result<Entry, String> {
        if !valid_server_id(server_id) {
            return Err(format!("{server_id:?} is not a server id"));
        }
        let store = {
            let mut guard = self
                .store
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if guard.is_none() {
                *guard = Some((self.open)()?);
            }
            guard.clone().expect("the store was just opened")
        };
        store
            .build(&self.service, &format!("server:{server_id}"), None)
            .map_err(describe)
    }

    /// Keeps the key of a server, replacing the one it had.
    pub fn save(&self, server_id: &str, token: &str) -> Result<(), String> {
        if token.is_empty() || token.len() > MAX_TOKEN_LEN {
            return Err("The API key is empty or too long to keep.".to_string());
        }
        self.entry(server_id)?.set_password(token).map_err(describe)
    }

    /// The key kept for a server, or None when there is none.
    pub fn load(&self, server_id: &str) -> Result<Option<String>, String> {
        match self.entry(server_id)?.get_password() {
            Ok(token) => Ok(Some(token)),
            Err(Error::NoEntry) => Ok(None),
            Err(error) => Err(describe(error)),
        }
    }

    /// Forgets the key of a server. A server with none is fine.
    pub fn remove(&self, server_id: &str) -> Result<(), String> {
        match self.entry(server_id)?.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(error) => Err(describe(error)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use keyring_core::mock;

    const ID: &str = "e571478f-9167-41ff-89b5-bd3500ebe196";

    fn credentials(service: &str, store: &Arc<CredentialStore>) -> Credentials {
        let store = store.clone();
        Credentials::new(service, move || Ok(store.clone()))
    }

    fn mock_store() -> Arc<CredentialStore> {
        mock::Store::new().unwrap()
    }

    #[test]
    fn a_saved_key_comes_back_and_none_is_none() {
        let credentials = credentials("com.gemiredmine.app", &mock_store());
        assert_eq!(credentials.load(ID), Ok(None));

        credentials.save(ID, "0123456789abcdef").unwrap();

        assert_eq!(
            credentials.load(ID),
            Ok(Some("0123456789abcdef".to_string()))
        );
    }

    #[test]
    fn a_refused_session_key_is_tried_again_until_it_is_accepted() {
        let mut calls = 0;
        let result = retry_session(
            5,
            || {
                calls += 1;
                if calls < 3 {
                    Err(KEY_SIZE_REFUSED)
                } else {
                    Ok(calls)
                }
            },
            |error| *error == KEY_SIZE_REFUSED,
        );

        assert_eq!(result, Ok(3));
        assert_eq!(calls, 3);
    }

    #[test]
    fn other_failures_are_not_tried_again_and_the_last_error_is_kept() {
        let mut calls = 0;
        let other: Result<(), &str> = retry_session(
            5,
            || {
                calls += 1;
                Err("no bus")
            },
            |error| *error == KEY_SIZE_REFUSED,
        );
        assert_eq!(other, Err("no bus"));
        assert_eq!(calls, 1);

        calls = 0;
        let exhausted: Result<(), &str> = retry_session(
            5,
            || {
                calls += 1;
                Err(KEY_SIZE_REFUSED)
            },
            |error| *error == KEY_SIZE_REFUSED,
        );
        assert_eq!(exhausted, Err(KEY_SIZE_REFUSED));
        assert_eq!(calls, 5);
    }

    #[test]
    fn saving_again_replaces_the_key() {
        let credentials = credentials("com.gemiredmine.app", &mock_store());
        credentials.save(ID, "first").unwrap();
        credentials.save(ID, "second").unwrap();

        assert_eq!(credentials.load(ID), Ok(Some("second".to_string())));
    }

    #[test]
    fn a_removed_key_is_gone_and_removing_nothing_is_fine() {
        let credentials = credentials("com.gemiredmine.app", &mock_store());
        credentials.save(ID, "key").unwrap();

        credentials.remove(ID).unwrap();
        assert_eq!(credentials.load(ID), Ok(None));
        credentials.remove(ID).unwrap();
    }

    #[test]
    fn each_server_and_each_channel_has_its_own_key() {
        let store = mock_store();
        let stable = credentials("com.gemiredmine.app", &store);
        let unstable = credentials("com.gemiredmine.app.unstable", &store);

        stable.save("one", "stable-one").unwrap();
        unstable.save("one", "unstable-one").unwrap();
        stable.save("two", "stable-two").unwrap();
        stable.remove("two").unwrap();

        assert_eq!(stable.load("one"), Ok(Some("stable-one".to_string())));
        assert_eq!(unstable.load("one"), Ok(Some("unstable-one".to_string())));
        assert_eq!(stable.load("two"), Ok(None));
    }

    #[test]
    fn a_name_that_is_not_a_server_id_is_refused() {
        let credentials = credentials("com.gemiredmine.app", &mock_store());
        let too_long = "x".repeat(65);
        for id in ["", "a b", "a/b", "../x", "id:1", "é", too_long.as_str()] {
            assert!(credentials.save(id, "key").is_err(), "{id:?}");
            assert!(credentials.load(id).is_err(), "{id:?}");
            assert!(credentials.remove(id).is_err(), "{id:?}");
        }
    }

    #[test]
    fn an_empty_or_huge_key_is_refused() {
        let credentials = credentials("com.gemiredmine.app", &mock_store());

        assert!(credentials.save(ID, "").is_err());
        assert!(
            credentials
                .save(ID, &"k".repeat(MAX_TOKEN_LEN + 1))
                .is_err()
        );
        assert!(credentials.save(ID, &"k".repeat(MAX_TOKEN_LEN)).is_ok());
    }

    #[test]
    fn a_store_that_cannot_be_opened_says_why_and_is_tried_again() {
        let attempts = Arc::new(Mutex::new(0));
        let seen = attempts.clone();
        let store = mock_store();
        let credentials = Credentials::new("com.gemiredmine.app", move || {
            let mut count = seen.lock().unwrap();
            *count += 1;
            if *count == 1 {
                Err("no Secret Service on this machine".to_string())
            } else {
                Ok(store.clone())
            }
        });

        assert_eq!(
            credentials.save(ID, "key"),
            Err("no Secret Service on this machine".to_string())
        );
        credentials.save(ID, "key").unwrap();
        credentials.load(ID).unwrap();

        // Opened once more after the failure, and then kept.
        assert_eq!(*attempts.lock().unwrap(), 2);
    }

    #[test]
    fn a_failure_of_the_store_is_reported_without_the_key() {
        let store = mock_store();
        let credentials = credentials("com.gemiredmine.app", &store);
        credentials.save(ID, "the-secret-key").unwrap();
        let entry = store
            .build("com.gemiredmine.app", &format!("server:{ID}"), None)
            .unwrap();
        let cred: &mock::Cred = entry.as_any().downcast_ref().unwrap();
        cred.set_error(Error::NoStorageAccess("the keyring is locked".into()));

        let message = credentials.load(ID).unwrap_err();

        assert!(message.contains("locked"), "{message}");
        assert!(!message.contains("the-secret-key"), "{message}");
    }
}
