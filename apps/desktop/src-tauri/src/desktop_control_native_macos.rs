use crate::desktop_control_native::{
    command_exists, coordinate_arg, read_png_response, run_command, temp_png_path, ClickAction,
    ClickRequest, ClickResponse, DesktopControlAction, DesktopControlActionResponse,
    DesktopControlCapabilities, DesktopControlCapability, DesktopControlError,
    DesktopControlStatus, HotkeyRequest, HotkeyResponse, KeyRequest, KeyResponse,
    ScreenshotRequest, ScrollRequest, ScrollResponse, TypeTextRequest, TypeTextResponse,
    WaitRequest, WaitResponse,
};
use std::thread;
use std::time::Duration;

const ACCESSIBILITY_REASON: &str =
    "osascript/System Events requires macOS Accessibility permission for OpenAWork";

pub fn status() -> DesktopControlStatus {
    let screenshot = if command_exists("screencapture") {
        DesktopControlCapability::available("screencapture")
    } else {
        DesktopControlCapability::unavailable("screencapture not found")
    };
    let input = if command_exists("osascript") {
        DesktopControlCapability::available("osascript-system-events")
    } else {
        DesktopControlCapability::unavailable("osascript not found")
    };
    DesktopControlStatus {
        enabled: true,
        reason: Some(ACCESSIBILITY_REASON.to_owned()),
        capabilities: DesktopControlCapabilities {
            screenshot,
            click: input.clone(),
            type_text: input.clone(),
            key: input.clone(),
            hotkey: input,
            scroll: DesktopControlCapability::unavailable(
                "generic macOS scroll is not implemented",
            ),
            wait: DesktopControlCapability::available("std-thread-sleep"),
        },
    }
}

pub fn execute_action(
    action: DesktopControlAction,
) -> Result<DesktopControlActionResponse, DesktopControlError> {
    match action {
        DesktopControlAction::Screenshot(request) => {
            capture_screenshot(request).map(DesktopControlActionResponse::Screenshot)
        }
        DesktopControlAction::Click(request) => {
            click(request).map(DesktopControlActionResponse::Click)
        }
        DesktopControlAction::TypeText(request) => {
            type_text(request).map(DesktopControlActionResponse::TypeText)
        }
        DesktopControlAction::Key(request) => key(request).map(DesktopControlActionResponse::Key),
        DesktopControlAction::Hotkey(request) => {
            hotkey(request).map(DesktopControlActionResponse::Hotkey)
        }
        DesktopControlAction::Scroll(request) => {
            scroll(request).map(DesktopControlActionResponse::Scroll)
        }
        DesktopControlAction::Wait(request) => {
            Ok(DesktopControlActionResponse::Wait(wait(request)))
        }
    }
}

fn capture_screenshot(
    request: ScreenshotRequest,
) -> Result<crate::desktop_control_native::ScreenshotResponse, DesktopControlError> {
    if let Some(delay_ms) = request.delay_ms {
        thread::sleep(Duration::from_millis(delay_ms.min(5_000)));
    }
    if !command_exists("screencapture") {
        return Err(DesktopControlError::new("screencapture not found"));
    }
    let path = temp_png_path("openawork-desktop-control");
    run_command(
        "screencapture",
        &[
            "-x".to_owned(),
            "-t".to_owned(),
            "png".to_owned(),
            path.to_string_lossy().to_string(),
        ],
    )?;
    read_png_response(&path, "screencapture")
}

fn click(request: ClickRequest) -> Result<ClickResponse, DesktopControlError> {
    match request.button {
        crate::desktop_control_native::MouseButton::Left => {}
        crate::desktop_control_native::MouseButton::Right
        | crate::desktop_control_native::MouseButton::Middle => {
            return Err(DesktopControlError::new(
                "macOS osascript click driver only supports left mouse button",
            ));
        }
    }
    let script = match request.click_action {
        ClickAction::Click => click_script(request.x, request.y, 1),
        ClickAction::DoubleClick => click_script(request.x, request.y, 2),
        ClickAction::Down | ClickAction::Up => {
            return Err(DesktopControlError::new(
                "macOS osascript click driver does not support mouse down/up",
            ));
        }
    };
    run_osascript(script)?;
    Ok(ClickResponse {
        success: true,
        x: request.x,
        y: request.y,
        button: request.button,
        action: request.click_action,
        driver: "osascript-system-events".to_owned(),
    })
}

fn type_text(request: TypeTextRequest) -> Result<TypeTextResponse, DesktopControlError> {
    run_osascript(format!(
        "tell application \"System Events\" to keystroke \"{}\"",
        apple_string(&request.text)
    ))?;
    Ok(TypeTextResponse {
        success: true,
        mode: "text",
        text_length: request.text.chars().count(),
        driver: "osascript-system-events".to_owned(),
    })
}

fn key(request: KeyRequest) -> Result<KeyResponse, DesktopControlError> {
    run_osascript(key_script(&request.key, None)?)?;
    Ok(KeyResponse {
        success: true,
        mode: "key",
        key: request.key,
        driver: "osascript-system-events".to_owned(),
    })
}

fn hotkey(request: HotkeyRequest) -> Result<HotkeyResponse, DesktopControlError> {
    if request.keys.len() < 2 {
        return Err(DesktopControlError::new(
            "hotkey requires at least one modifier and one key",
        ));
    }
    let modifiers = request.keys[..request.keys.len() - 1]
        .iter()
        .map(|key| apple_modifier(key))
        .collect::<Result<Vec<_>, _>>()?;
    let main_key = request.keys[request.keys.len() - 1].clone();
    run_osascript(key_script(&main_key, Some(&modifiers))?)?;
    Ok(HotkeyResponse {
        success: true,
        mode: "hotkey",
        keys: request.keys,
        driver: "osascript-system-events".to_owned(),
    })
}

fn scroll(request: ScrollRequest) -> Result<ScrollResponse, DesktopControlError> {
    Err(DesktopControlError::new(format!(
        "macOS generic scroll is not implemented (scrollX={}, scrollY={})",
        request.scroll_x, request.scroll_y
    )))
}

fn wait(request: WaitRequest) -> WaitResponse {
    let ms = request.ms.min(10_000);
    thread::sleep(Duration::from_millis(ms));
    WaitResponse { success: true, ms }
}

fn run_osascript(script: String) -> Result<(), DesktopControlError> {
    if !command_exists("osascript") {
        return Err(DesktopControlError::new("osascript not found"));
    }
    run_command("osascript", &["-e".to_owned(), script])
}

fn click_script(x: f64, y: f64, count: u8) -> String {
    let line = format!("click at {{{}, {}}}", coordinate_arg(x), coordinate_arg(y));
    let body = (0..count)
        .map(|_| line.clone())
        .collect::<Vec<_>>()
        .join("\n");
    format!("tell application \"System Events\"\n{body}\nend tell")
}

fn key_script(key: &str, modifiers: Option<&[String]>) -> Result<String, DesktopControlError> {
    let using = match modifiers {
        Some(items) if !items.is_empty() => format!(" using {{{}}}", items.join(", ")),
        Some(_) | None => String::new(),
    };
    if let Some(code) = apple_key_code(key) {
        return Ok(format!(
            "tell application \"System Events\" to key code {code}{using}"
        ));
    }
    if is_single_ascii_alphanumeric(key) {
        return Ok(format!(
            "tell application \"System Events\" to keystroke \"{}\"{using}",
            apple_string(&key.to_ascii_lowercase())
        ));
    }
    Err(DesktopControlError::new(format!("unsupported key: {key}")))
}

fn apple_modifier(value: &str) -> Result<String, DesktopControlError> {
    match value {
        "Control" | "Ctrl" => Ok("control down".to_owned()),
        "Meta" | "Command" | "Cmd" => Ok("command down".to_owned()),
        "Alt" | "Option" => Ok("option down".to_owned()),
        "Shift" => Ok("shift down".to_owned()),
        _ => Err(DesktopControlError::new(format!(
            "unsupported hotkey modifier: {value}"
        ))),
    }
}

fn apple_key_code(value: &str) -> Option<u16> {
    match value {
        "Enter" => Some(36),
        "Tab" => Some(48),
        "Escape" => Some(53),
        "Backspace" => Some(51),
        "Delete" => Some(117),
        "ArrowUp" => Some(126),
        "ArrowDown" => Some(125),
        "ArrowLeft" => Some(123),
        "ArrowRight" => Some(124),
        "Home" => Some(115),
        "End" => Some(119),
        "PageUp" => Some(116),
        "PageDown" => Some(121),
        "Space" => Some(49),
        _ => None,
    }
}

fn apple_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn is_single_ascii_alphanumeric(value: &str) -> bool {
    let mut chars = value.chars();
    match (chars.next(), chars.next()) {
        (Some(ch), None) => ch.is_ascii_alphanumeric(),
        _ => false,
    }
}
