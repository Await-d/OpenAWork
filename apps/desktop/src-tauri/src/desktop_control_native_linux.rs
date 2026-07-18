use crate::desktop_control_native::{
    command_exists, read_png_response, run_command, temp_png_path, DesktopControlAction, DesktopControlActionResponse,
    DesktopControlCapabilities, DesktopControlCapability, DesktopControlError, DesktopControlStatus,
    ScreenshotRequest,
};
use std::env;
use std::path::Path;
use std::thread;
use std::time::Duration;

#[path = "desktop_control_native_linux_input.rs"]
mod input;

const INPUT_UNAVAILABLE: &str = "xdotool not found; install xdotool and run under an X11 session";
const WAYLAND_INPUT_UNAVAILABLE: &str =
    "Wayland session detected; input control requires xdotool and an X11 session";
const SCREENSHOT_UNAVAILABLE: &str =
    "no supported screenshot command found; expected gnome-screenshot, grim, spectacle, scrot, or import";

struct CommandSpec {
    program: &'static str,
    driver: &'static str,
    args: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LinuxSessionKind {
    Wayland,
    X11,
    Unknown,
}

pub fn status() -> DesktopControlStatus {
    let session = linux_session_kind();
    let screenshot = match screenshot_driver() {
        Some(driver) => DesktopControlCapability::available(driver),
        None => DesktopControlCapability::unavailable(SCREENSHOT_UNAVAILABLE),
    };
    let input = input_capability(session);
    DesktopControlStatus {
        enabled: true,
        reason: limited_native_reason(session, &screenshot, &input),
        capabilities: DesktopControlCapabilities {
            screenshot,
            click: input.clone(),
            type_text: input.clone(),
            key: input.clone(),
            hotkey: input.clone(),
            scroll: input,
            wait: DesktopControlCapability::available("std-thread-sleep"),
        },
    }
}

pub fn execute_action(
    action: DesktopControlAction,
) -> Result<DesktopControlActionResponse, DesktopControlError> {
    match action {
        DesktopControlAction::Screenshot(request) => capture_screenshot(request)
            .map(DesktopControlActionResponse::Screenshot),
        DesktopControlAction::Click(request) => input::click(request)
            .map(DesktopControlActionResponse::Click),
        DesktopControlAction::TypeText(request) => {
            input::type_text(request).map(DesktopControlActionResponse::TypeText)
        }
        DesktopControlAction::Key(request) => input::key(request)
            .map(DesktopControlActionResponse::Key),
        DesktopControlAction::Hotkey(request) => {
            input::hotkey(request).map(DesktopControlActionResponse::Hotkey)
        }
        DesktopControlAction::Scroll(request) => {
            input::scroll(request).map(DesktopControlActionResponse::Scroll)
        }
        DesktopControlAction::Wait(request) => Ok(DesktopControlActionResponse::Wait(input::wait(request))),
    }
}

fn screenshot_driver() -> Option<&'static str> {
    ["gnome-screenshot", "grim", "spectacle", "scrot", "import"]
        .into_iter()
        .find(|program| command_exists(program))
}

fn linux_session_kind() -> LinuxSessionKind {
    linux_session_kind_from_env(
        env::var("XDG_SESSION_TYPE").ok().as_deref(),
        env::var_os("WAYLAND_DISPLAY").is_some(),
        env::var_os("DISPLAY").is_some(),
    )
}

fn linux_session_kind_from_env(
    xdg_session_type: Option<&str>,
    has_wayland_display: bool,
    has_display: bool,
) -> LinuxSessionKind {
    if let Some(session_type) = xdg_session_type {
        if session_type.eq_ignore_ascii_case("wayland") {
            return LinuxSessionKind::Wayland;
        }
        if session_type.eq_ignore_ascii_case("x11") {
            return LinuxSessionKind::X11;
        }
    }

    if has_wayland_display {
        LinuxSessionKind::Wayland
    } else if has_display {
        LinuxSessionKind::X11
    } else {
        LinuxSessionKind::Unknown
    }
}

fn input_unavailable_reason_for(session: LinuxSessionKind) -> &'static str {
    match session {
        LinuxSessionKind::Wayland => WAYLAND_INPUT_UNAVAILABLE,
        LinuxSessionKind::X11 | LinuxSessionKind::Unknown => INPUT_UNAVAILABLE,
    }
}

pub(super) fn input_unavailable_reason() -> &'static str {
    input_unavailable_reason_for(linux_session_kind())
}

fn input_capability(session: LinuxSessionKind) -> DesktopControlCapability {
    if matches!(session, LinuxSessionKind::Wayland) {
        DesktopControlCapability::unavailable(WAYLAND_INPUT_UNAVAILABLE)
    } else if command_exists("xdotool") {
        DesktopControlCapability::available("xdotool")
    } else {
        DesktopControlCapability::unavailable(INPUT_UNAVAILABLE)
    }
}

fn limited_native_reason(
    session: LinuxSessionKind,
    screenshot: &DesktopControlCapability,
    input: &DesktopControlCapability,
) -> Option<String> {
    if screenshot.available && input.available {
        return None;
    }

    let mut reason = String::from("desktop control bridge is running with limited native drivers");
    if !screenshot.available {
        reason.push_str("; ");
        reason.push_str(SCREENSHOT_UNAVAILABLE);
    }
    if !input.available {
        reason.push_str("; ");
        reason.push_str(
            input
                .reason
                .as_deref()
                .unwrap_or_else(|| input_unavailable_reason_for(session)),
        );
    }
    Some(reason)
}

fn capture_screenshot(
    request: ScreenshotRequest,
) -> Result<crate::desktop_control_native::ScreenshotResponse, DesktopControlError> {
    if let Some(delay_ms) = request.delay_ms {
        thread::sleep(Duration::from_millis(delay_ms.min(5_000)));
    }
    let path = temp_png_path("openawork-desktop-control");
    let mut last_error = None;
    for command in screenshot_commands(&path) {
        if !command_exists(command.program) {
            continue;
        }
        match run_command(command.program, &command.args) {
            Ok(()) => return read_png_response(&path, command.driver),
            Err(error) => last_error = Some(error.message().to_owned()),
        }
    }
    Err(DesktopControlError::new(
        match last_error {
            Some(message) => message,
            None => SCREENSHOT_UNAVAILABLE.to_owned(),
        },
    ))
}

fn screenshot_commands(path: &Path) -> Vec<CommandSpec> {
    let file = path.to_string_lossy().to_string();
    vec![
        CommandSpec {
            program: "gnome-screenshot",
            driver: "gnome-screenshot",
            args: vec!["-f".to_owned(), file.clone()],
        },
        CommandSpec {
            program: "grim",
            driver: "grim",
            args: vec![file.clone()],
        },
        CommandSpec {
            program: "spectacle",
            driver: "spectacle",
            args: vec!["-b".to_owned(), "-n".to_owned(), "-o".to_owned(), file.clone()],
        },
        CommandSpec {
            program: "scrot",
            driver: "scrot",
            args: vec![file.clone()],
        },
        CommandSpec {
            program: "import",
            driver: "imagemagick-import",
            args: vec!["-window".to_owned(), "root".to_owned(), file],
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_wayland_from_session_type_or_wayland_display() {
        assert_eq!(
            linux_session_kind_from_env(Some("wayland"), false, true),
            LinuxSessionKind::Wayland,
        );
        assert_eq!(
            linux_session_kind_from_env(None, true, true),
            LinuxSessionKind::Wayland,
        );
    }

    #[test]
    fn detects_x11_from_explicit_session_type_or_display() {
        assert_eq!(linux_session_kind_from_env(Some("x11"), true, true), LinuxSessionKind::X11);
        assert_eq!(linux_session_kind_from_env(None, false, true), LinuxSessionKind::X11);
    }

    #[test]
    fn wayland_session_disables_input_even_when_xdotool_is_present() {
        let input = input_capability(LinuxSessionKind::Wayland);
        assert!(!input.available);
        assert_eq!(input.reason.as_deref(), Some(WAYLAND_INPUT_UNAVAILABLE));
    }

    #[test]
    fn limited_native_reason_includes_session_specific_input_detail() {
        let screenshot = DesktopControlCapability::available("grim");
        let input = DesktopControlCapability::unavailable(WAYLAND_INPUT_UNAVAILABLE);
        let reason = limited_native_reason(LinuxSessionKind::Wayland, &screenshot, &input)
            .expect("reason should exist when input is unavailable");
        assert!(reason.contains("limited native drivers"));
        assert!(reason.contains("Wayland session detected"));
    }
}
