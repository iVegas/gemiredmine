//! Keeps the API keys of the Redmine servers on Android. Android has no system credential store that Rust can
//! reach, so the keys are encrypted with a key of the Android Keystore, in the app's private preferences. The
//! Kotlin side (android/src/main/java/app/gemiredmine/vault/CredentialVaultPlugin.kt) does the work and offers
//! the optional fingerprint or face unlock.
//!
//! This crate only registers that Kotlin class. On the desktop it does nothing, and the webview calls it only on
//! Android (src/mainview/lib/tauri-platform.ts).

use tauri::{
    Runtime,
    plugin::{Builder, TauriPlugin},
};

/// The package and class of the Kotlin plugin, as they are declared in android/src/main/java.
#[cfg(target_os = "android")]
const ANDROID_PACKAGE: &str = "app.gemiredmine.vault";
#[cfg(target_os = "android")]
const ANDROID_CLASS: &str = "CredentialVaultPlugin";

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("credential-vault")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _api.register_android_plugin(ANDROID_PACKAGE, ANDROID_CLASS)?;
            Ok(())
        })
        .build()
}
