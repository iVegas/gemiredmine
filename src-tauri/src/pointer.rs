//! Whether the primary mouse button is held down, anywhere on the screen.
//!
//! The window layer follows a view window while the user drags it by its title bar, and has to tell that
//! from a move the window manager made on its own. Tauri has no API for the state of the mouse buttons,
//! and the webview gets no pointer events while the system moves a window, so this asks the system.
//!
//! On Linux it reads the pointer through GDK. That is only meaningful where the app can see the whole
//! screen (X11): Wayland does not tell an application what the pointer is doing outside its own windows, and
//! a window cannot tell where it is, so the window layer never sees a window being dragged there and does
//! not call this. Putting a view window back on a Wayland session is done with a drag and drop instead.

/// The virtual key of the primary button on Windows: the right one when the user swapped the buttons.
#[cfg(any(windows, test))]
fn primary_virtual_key(buttons_swapped: bool) -> i32 {
    const VK_LBUTTON: i32 = 0x01;
    const VK_RBUTTON: i32 = 0x02;
    if buttons_swapped {
        VK_RBUTTON
    } else {
        VK_LBUTTON
    }
}

#[cfg(target_os = "linux")]
pub fn primary_button_down<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> bool {
    use gdk::prelude::SeatExt;
    use gtk::prelude::WidgetExt;

    let Ok(gtk_window) = window.gtk_window() else {
        return false;
    };
    let Some(gdk_window) = gtk_window.window() else {
        return false;
    };
    let Some(pointer) = gdk_window
        .display()
        .default_seat()
        .and_then(|seat| seat.pointer())
    else {
        return false;
    };
    let (_, _, _, modifiers) = gdk_window.device_position(&pointer);
    modifiers.contains(gdk::ModifierType::BUTTON1_MASK)
}

#[cfg(windows)]
pub fn primary_button_down<R: tauri::Runtime>(_window: &tauri::WebviewWindow<R>) -> bool {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_SWAPBUTTON};

    // SAFETY: both are plain queries with no pointers; they are safe to call from any thread.
    let state = unsafe {
        let swapped = GetSystemMetrics(SM_SWAPBUTTON) != 0;
        GetAsyncKeyState(primary_virtual_key(swapped))
    };
    // The most significant bit is set while the button is down.
    state < 0
}

#[cfg(not(any(target_os = "linux", windows)))]
pub fn primary_button_down<R: tauri::Runtime>(_window: &tauri::WebviewWindow<R>) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::primary_virtual_key;

    #[test]
    fn the_primary_button_follows_the_users_swap_setting() {
        assert_eq!(primary_virtual_key(false), 0x01);
        assert_eq!(primary_virtual_key(true), 0x02);
    }
}
