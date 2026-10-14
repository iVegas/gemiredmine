//! The desktop shell. The app itself is TypeScript running in the webview; this crate only wires up
//! the plugins it needs and reports what the webview cannot find out for itself.
//!
//! Keep it that way: anything about Redmine, diagnostics or the UI belongs in `src/`, where the
//! unit tests and the Android build reach it.

use std::ffi::OsString;
use std::path::PathBuf;

use serde::Serialize;
use tauri_plugin_fs::FsExt;

/// The folder named by `GEMIREDMINE_DATA_DIR`, made absolute. Empty means unset.
///
/// A relative value is resolved against the working directory the app was started from, which is
/// what the Electrobun build did too. `std::path::absolute` does not touch the disk, so the folder
/// does not have to exist yet.
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![app_environment])
        .setup(|app| {
            // The capability files scope file access to the channel's own data folder. A folder chosen
            // with GEMIREDMINE_DATA_DIR is outside it, so allow that one explicitly.
            if let Some(dir) = data_dir_override() {
                app.fs_scope().allow_directory(&dir, true)?;
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
    fn a_relative_path_is_resolved_against_the_working_directory() {
        let resolved = data_dir_from(Some(OsString::from("some/folder"))).unwrap();
        assert!(resolved.is_absolute());
        assert!(resolved.ends_with("some/folder"));
    }
}
