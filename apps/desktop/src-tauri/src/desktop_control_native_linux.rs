use crate::desktop_control_native::{
    command_exists, read_png_response, run_command, temp_png_path, DesktopControlAction, DesktopControlActionResponse,
    DesktopControlCapabilities, DesktopControlCapability, DesktopControlError, DesktopControlStatus,
    ScreenshotRequest,
};
use std::path::Path;
use std::thread;
use std::time::Duration;

#[path = "desktop_control_native_linux_input.rs"]
mod input;

const INPUT_UNAVAILABLE: &str = "xdotool not found; install xdotool and run under an X11 session";
const SCREENSHOT_UNAVAILABLE: &str =
    "no supported screenshot command found; expected gnome-screenshot, grim, spectacle, scrot, or import";

struct CommandSpec {
    program: &'static str,
    driver: &'static str,
    args: Vec<String>,
}

pub fn status() -> DesktopControlStatus {
    let screenshot = match screenshot_driver() {
        Some(driver) => DesktopControlCapability::available(driver),
        None => DesktopControlCapability::unavailable(SCREENSHOT_UNAVAILABLE),
    };
    let input = match input_driver() {
        Some(driver) => DesktopControlCapability::available(driver),
        None => DesktopControlCapability::unavailable(INPUT_UNAVAILABLE),
    };
    let reason = if screenshot.available && input.available {
        None
    } else {
        Some("desktop control bridge is running with limited native drivers".to_owned())
    };
    DesktopControlStatus {
        enabled: true,
        reason,
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

fn input_driver() -> Option<&'static str> {
    if command_exists("xdotool") {
        Some("xdotool")
    } else {
        None
    }
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
