#[path = "desktop_control_native_common.rs"]
mod desktop_control_native_common;
#[path = "desktop_control_native_models.rs"]
mod desktop_control_native_models;

#[cfg(target_os = "linux")]
#[path = "desktop_control_native_linux.rs"]
mod platform;
#[cfg(target_os = "macos")]
#[path = "desktop_control_native_macos.rs"]
mod platform;
#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
#[path = "desktop_control_native_unsupported.rs"]
mod platform;
#[cfg(target_os = "windows")]
#[path = "desktop_control_native_windows.rs"]
mod platform;

pub use self::desktop_control_native_common::{
    command_exists, coordinate_arg, read_png_response, run_command, temp_png_path,
    DesktopControlError,
};
pub use self::desktop_control_native_models::{
    ClickAction, ClickRequest, ClickResponse, DesktopControlAction, DesktopControlActionResponse,
    DesktopControlCapabilities, DesktopControlCapability, DesktopControlStatus, HotkeyRequest,
    HotkeyResponse, KeyRequest, KeyResponse, MouseButton, ScreenshotRequest, ScreenshotResponse,
    ScrollRequest, ScrollResponse, TypeTextRequest, TypeTextResponse, WaitRequest, WaitResponse,
};

pub fn status() -> DesktopControlStatus {
    platform::status()
}

pub async fn execute_action(
    action: DesktopControlAction,
) -> Result<DesktopControlActionResponse, DesktopControlError> {
    tokio::task::spawn_blocking(move || platform::execute_action(action))
        .await
        .map_err(|e| DesktopControlError::new(format!("desktop control worker failed: {e}")))?
}
