// The commands are written in Kotlin (android/src/main/java), so the permissions for them are generated here: the
// webview may call them only when the app's capability grants them (src-tauri/capabilities).
const COMMANDS: &[&str] = &["save", "load", "remove", "status", "biometric"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
