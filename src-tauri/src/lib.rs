//! The desktop shell. The app itself is TypeScript running in the webview; this crate only wires up
//! the plugins it needs and reports what the webview cannot find out for itself.
//!
//! Keep it that way: anything about Redmine, diagnostics or the UI belongs in `src/`, where the
//! unit tests and the Android build reach it.

mod credentials;
mod pointer;

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use tauri::Manager;
use tauri_plugin_fs::FsExt;

/// The folder named by `GEMIREDMINE_DATA_DIR`, made absolute. Empty means unset.
///
/// A relative value is resolved against the working directory the app was started from.
/// `std::path::absolute` does not touch the disk, so the folder does not have to exist yet.
fn data_dir_from(value: Option<OsString>) -> Option<PathBuf> {
    let value = value.filter(|value| !value.is_empty())?;
    std::path::absolute(PathBuf::from(value)).ok()
}

fn data_dir_override() -> Option<PathBuf> {
    data_dir_from(std::env::var_os("GEMIREDMINE_DATA_DIR"))
}

/// What the webview cannot read from its own environment.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppEnvironment {
    /// The absolute `GEMIREDMINE_DATA_DIR`, when set.
    data_dir_override: Option<String>,
    tauri: &'static str,
    webview: String,
    os: &'static str,
    arch: &'static str,
}

#[tauri::command]
fn app_environment() -> AppEnvironment {
    AppEnvironment {
        data_dir_override: data_dir_override().map(|dir| dir.to_string_lossy().into_owned()),
        tauri: tauri::VERSION,
        webview: tauri::webview_version().unwrap_or_else(|_| "unknown".into()),
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
    }
}

/// The folder that holds a channel's database: the `GEMIREDMINE_DATA_DIR` folder when that is set, otherwise the
/// channel's folder `name` below the user's local data folder. The webview names the channel's folder, never a path,
/// so a request cannot place the folder somewhere else.
fn storage_dir_in(
    override_dir: Option<PathBuf>,
    local_data_dir: PathBuf,
    name: &str,
) -> Result<PathBuf, String> {
    if let Some(dir) = override_dir {
        return Ok(dir);
    }
    let plain = !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !plain {
        return Err(format!("{name:?} is not a folder name for the app's data"));
    }
    Ok(local_data_dir.join(name))
}

/// Makes the folder, and any parent that is missing. On systems with permission bits the new folders are private to
/// the user (0700), as the developer preview's are.
fn create_private_dir(dir: &Path) -> std::io::Result<()> {
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
    builder.create(dir)
}

/// Makes sure the folder of the channel's database exists and returns its path. The SQL plugin creates the database
/// file but not the folder around it, and the webview has no file access of its own in a stable build.
#[tauri::command]
fn prepare_storage_dir(app: tauri::AppHandle, name: String) -> Result<String, String> {
    let local_data_dir = app
        .path()
        .local_data_dir()
        .map_err(|error| error.to_string())?;
    let dir = storage_dir_in(data_dir_override(), local_data_dir, &name)?;
    create_private_dir(&dir)
        .map_err(|error| format!("Could not create {}: {error}", dir.display()))?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Runs a call on the credential store on a thread of its own: the store can wait for the user, for example for the
/// password that unlocks the keyring, and the window must not stand still meanwhile.
async fn on_credentials<T: Send + 'static>(
    credentials: tauri::State<'_, Arc<credentials::Credentials>>,
    call: impl FnOnce(&credentials::Credentials) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let credentials = credentials.inner().clone();
    tauri::async_runtime::spawn_blocking(move || call(&credentials))
        .await
        .map_err(|error| error.to_string())?
}

/// Keeps the API key of a server in the system's credential store.
#[tauri::command]
async fn credential_save(
    credentials: tauri::State<'_, Arc<credentials::Credentials>>,
    server_id: String,
    token: String,
) -> Result<(), String> {
    on_credentials(credentials, move |store| store.save(&server_id, &token)).await
}

/// The API key kept for a server, or nothing.
#[tauri::command]
async fn credential_load(
    credentials: tauri::State<'_, Arc<credentials::Credentials>>,
    server_id: String,
) -> Result<Option<String>, String> {
    on_credentials(credentials, move |store| store.load(&server_id)).await
}

/// Forgets the API key of a server.
#[tauri::command]
async fn credential_delete(
    credentials: tauri::State<'_, Arc<credentials::Credentials>>,
    server_id: String,
) -> Result<(), String> {
    on_credentials(credentials, move |store| store.remove(&server_id)).await
}

/// Brings the main window forward, for a second start of the app.
#[cfg(desktop)]
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Whether the primary mouse button is held down anywhere on screen. The window layer needs it to follow a
/// view window that the user drags by its title bar. A synchronous command, so it runs on the main thread,
/// which GDK requires.
#[tauri::command]
fn primary_button_down(window: tauri::WebviewWindow) -> bool {
    pointer::primary_button_down(&window)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // One copy of the app runs per channel. This plugin has to be the first, so that a second copy hands over and
    // ends before it opens anything. The channels have their own identifiers, so they still run side by side.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        show_main_window(app);
    }));
    builder
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_credential_vault::init())
        // The schema is created and updated by the TypeScript side (src/bun/storage/migrations.ts), so the plugin has no
        // migrations of its own to run: the database is opened at a path that depends on the channel.
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            app_environment,
            primary_button_down,
            prepare_storage_dir,
            credential_save,
            credential_load,
            credential_delete
        ])
        .on_window_event(|window, event| {
            // View windows belong to the main window: when it is gone the app ends, whatever else is open.
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                window.app_handle().exit(0);
            }
        })
        .setup(|app| {
            // The keys are kept per channel: the identifier names the service in the credential store.
            let service = app.config().identifier.clone();
            app.manage(Arc::new(credentials::Credentials::new(
                service,
                credentials::native_store,
            )));
            // The capability files scope file access to the channel's own data folder. A folder chosen
            // with GEMIREDMINE_DATA_DIR is outside it, so allow that one explicitly.
            if let Some(dir) = data_dir_override() {
                app.fs_scope().allow_directory(&dir, true)?;
            }
            // Under Flatpak the window's app id must be the app's ID. The desktop shell finds a window's icon by the
            // desktop file of that name, and Flatpak installs it under the app ID. GTK sends its program class as the
            // app id, and by default that is the program name.
            #[cfg(target_os = "linux")]
            if let Ok(app_id) = std::env::var("FLATPAK_ID") {
                gdk::set_program_class(&app_id);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Gemiredmine");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unset_or_empty_means_no_override() {
        assert_eq!(data_dir_from(None), None);
        assert_eq!(data_dir_from(Some(OsString::new())), None);
    }

    #[test]
    fn an_absolute_path_is_kept() {
        let dir = std::env::temp_dir().join("gemiredmine-data");
        assert_eq!(data_dir_from(Some(dir.clone().into_os_string())), Some(dir));
    }

    #[test]
    fn the_database_goes_in_the_channels_folder_below_the_local_data_folder() {
        let local = PathBuf::from("/home/alice/.local/share");
        assert_eq!(
            storage_dir_in(None, local.clone(), "gemiredmine-unstable"),
            Ok(local.join("gemiredmine-unstable"))
        );
    }

    #[test]
    fn the_data_dir_override_wins_and_needs_no_name() {
        let chosen = PathBuf::from("/tmp/chosen");
        assert_eq!(
            storage_dir_in(Some(chosen.clone()), PathBuf::from("/data"), ""),
            Ok(chosen)
        );
    }

    #[test]
    fn a_name_that_could_leave_the_local_data_folder_is_refused() {
        for name in [
            "",
            ".",
            "..",
            "../x",
            "a/b",
            "a\\b",
            "x y",
            "/etc",
            "C:\\Users",
        ] {
            assert!(
                storage_dir_in(None, PathBuf::from("/data"), name).is_err(),
                "{name:?}"
            );
        }
    }

    #[test]
    fn the_storage_folder_is_created_with_its_parents_and_may_exist_already() {
        let root = std::env::temp_dir().join(format!("gemiredmine-storage-{}", std::process::id()));
        let dir = root.join("one").join("two");
        create_private_dir(&dir).unwrap();
        create_private_dir(&dir).unwrap();
        assert!(dir.is_dir());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o700);
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_relative_path_is_resolved_against_the_working_directory() {
        let resolved = data_dir_from(Some(OsString::from("some/folder"))).unwrap();
        assert!(resolved.is_absolute());
        assert!(resolved.ends_with("some/folder"));
    }
}
