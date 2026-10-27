//! The microphone of the assistant's voice input.
//!
//! WebKitGTK refuses a microphone request unless the app allows it, and Gemiredmine has no prompt of its own on
//! Linux, so the request fails and the app says the microphone is not available. The main window shows the app's own
//! page, so it is allowed the microphone, and nothing else: a camera or the screen is refused, since nothing in the
//! app uses them. The other systems ask the user through their own prompts, so only Linux needs this.

/// Whether a media request asks for the microphone alone. A camera is refused. A screen request has neither audio nor
/// video in it (wry reads it that way too), so it is refused as well.
pub fn is_microphone_only(audio: bool, video: bool) -> bool {
    audio && !video
}

/// Allows the main window the microphone. The handler is kept by the webview for as long as it lives.
#[cfg(target_os = "linux")]
pub fn allow_for<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> tauri::Result<()> {
    use webkit2gtk::glib::Cast;
    use webkit2gtk::{PermissionRequestExt, UserMediaPermissionRequestExt, WebViewExt};

    window.with_webview(|webview| {
        webview
            .inner()
            .connect_permission_request(|_view, request| {
                let Some(media) = request.downcast_ref::<webkit2gtk::UserMediaPermissionRequest>()
                else {
                    // Only media requests are decided here. Any other request keeps WebKit's own handling.
                    return false;
                };
                if is_microphone_only(media.is_for_audio_device(), media.is_for_video_device()) {
                    media.allow();
                } else {
                    media.deny();
                }
                true
            });
    })
}

#[cfg(test)]
mod tests {
    use super::is_microphone_only;

    #[test]
    fn the_microphone_alone_is_allowed() {
        assert!(is_microphone_only(true, false));
    }

    #[test]
    fn a_camera_is_refused_even_with_the_microphone() {
        assert!(!is_microphone_only(true, true));
        assert!(!is_microphone_only(false, true));
    }

    #[test]
    fn a_screen_request_with_neither_audio_nor_video_is_refused() {
        assert!(!is_microphone_only(false, false));
    }
}
