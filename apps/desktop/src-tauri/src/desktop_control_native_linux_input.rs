use super::input_unavailable_reason;
use crate::desktop_control_native::{
    command_exists, coordinate_arg, run_command, ClickAction, ClickRequest, ClickResponse,
    DesktopControlError, HotkeyRequest, HotkeyResponse, KeyRequest, KeyResponse, MouseButton,
    ScrollRequest, ScrollResponse, TypeTextRequest, TypeTextResponse, WaitRequest, WaitResponse,
};
use std::thread;
use std::time::Duration;

pub fn click(request: ClickRequest) -> Result<ClickResponse, DesktopControlError> {
    require_xdotool()?;
    let button = mouse_button_arg(request.button);
    let mut args = vec![
        "mousemove".to_owned(),
        coordinate_arg(request.x),
        coordinate_arg(request.y),
    ];
    match request.click_action {
        ClickAction::Click => args.extend(["click".to_owned(), button.to_owned()]),
        ClickAction::DoubleClick => args.extend([
            "click".to_owned(),
            "--repeat".to_owned(),
            "2".to_owned(),
            "--delay".to_owned(),
            "80".to_owned(),
            button.to_owned(),
        ]),
        ClickAction::Down => args.extend(["mousedown".to_owned(), button.to_owned()]),
        ClickAction::Up => args.extend(["mouseup".to_owned(), button.to_owned()]),
    }
    run_command("xdotool", &args)?;
    Ok(ClickResponse {
        success: true,
        x: request.x,
        y: request.y,
        button: request.button,
        action: request.click_action,
        driver: "xdotool".to_owned(),
    })
}

pub fn type_text(request: TypeTextRequest) -> Result<TypeTextResponse, DesktopControlError> {
    require_xdotool()?;
    run_command(
        "xdotool",
        &[
            "type".to_owned(),
            "--delay".to_owned(),
            "0".to_owned(),
            "--".to_owned(),
            request.text.clone(),
        ],
    )?;
    Ok(TypeTextResponse {
        success: true,
        mode: "text",
        text_length: request.text.chars().count(),
        driver: "xdotool".to_owned(),
    })
}

pub fn key(request: KeyRequest) -> Result<KeyResponse, DesktopControlError> {
    require_xdotool()?;
    let resolved = xdotool_key(&request.key)?;
    run_command("xdotool", &["key".to_owned(), resolved])?;
    Ok(KeyResponse {
        success: true,
        mode: "key",
        key: request.key,
        driver: "xdotool".to_owned(),
    })
}

pub fn hotkey(request: HotkeyRequest) -> Result<HotkeyResponse, DesktopControlError> {
    require_xdotool()?;
    if request.keys.len() < 2 {
        return Err(DesktopControlError::new(
            "hotkey requires at least one modifier and one key",
        ));
    }
    let last_index = request.keys.len() - 1;
    let mut resolved = Vec::with_capacity(request.keys.len());
    for (index, key) in request.keys.iter().enumerate() {
        if index == last_index {
            resolved.push(xdotool_key(key)?);
        } else {
            resolved.push(xdotool_modifier(key)?);
        }
    }
    run_command("xdotool", &["key".to_owned(), resolved.join("+")])?;
    Ok(HotkeyResponse {
        success: true,
        mode: "hotkey",
        keys: request.keys,
        driver: "xdotool".to_owned(),
    })
}

pub fn scroll(request: ScrollRequest) -> Result<ScrollResponse, DesktopControlError> {
    require_xdotool()?;
    match (request.x, request.y) {
        (Some(x), Some(y)) => run_command(
            "xdotool",
            &["mousemove".to_owned(), coordinate_arg(x), coordinate_arg(y)],
        )?,
        (None, None) => {}
        _ => {
            return Err(DesktopControlError::new(
                "scroll anchor requires both x and y coordinates",
            ));
        }
    }
    run_scroll_axis(request.scroll_y, "5", "4")?;
    run_scroll_axis(request.scroll_x, "7", "6")?;
    Ok(ScrollResponse {
        success: true,
        x: request.x,
        y: request.y,
        scroll_x: request.scroll_x,
        scroll_y: request.scroll_y,
        driver: "xdotool".to_owned(),
    })
}

pub fn wait(request: WaitRequest) -> WaitResponse {
    let ms = request.ms.min(10_000);
    thread::sleep(Duration::from_millis(ms));
    WaitResponse { success: true, ms }
}

fn require_xdotool() -> Result<(), DesktopControlError> {
    if command_exists("xdotool") {
        Ok(())
    } else {
        Err(DesktopControlError::new(input_unavailable_reason()))
    }
}

fn mouse_button_arg(button: MouseButton) -> &'static str {
    match button {
        MouseButton::Left => "1",
        MouseButton::Right => "3",
        MouseButton::Middle => "2",
    }
}

fn run_scroll_axis(
    delta: f64,
    positive_button: &str,
    negative_button: &str,
) -> Result<(), DesktopControlError> {
    let Some(steps) = wheel_steps(delta) else {
        return Ok(());
    };
    let button = if delta > 0.0 {
        positive_button
    } else {
        negative_button
    };
    run_command(
        "xdotool",
        &[
            "click".to_owned(),
            "--repeat".to_owned(),
            steps,
            button.to_owned(),
        ],
    )
}

fn wheel_steps(delta: f64) -> Option<String> {
    if delta.abs() <= f64::EPSILON {
        return None;
    }
    let steps = (delta.abs() / 120.0).ceil().clamp(1.0, 50.0);
    Some(format!("{steps:.0}"))
}

fn xdotool_modifier(value: &str) -> Result<String, DesktopControlError> {
    match value {
        "Control" | "Ctrl" => Ok("ctrl".to_owned()),
        "Meta" | "Command" | "Cmd" | "Super" => Ok("super".to_owned()),
        "Alt" | "Option" => Ok("alt".to_owned()),
        "Shift" => Ok("shift".to_owned()),
        _ => Err(DesktopControlError::new(format!(
            "unsupported hotkey modifier: {value}"
        ))),
    }
}

fn xdotool_key(value: &str) -> Result<String, DesktopControlError> {
    match value.trim() {
        "Enter" => Ok("Return".to_owned()),
        "Tab" => Ok("Tab".to_owned()),
        "Escape" => Ok("Escape".to_owned()),
        "Backspace" => Ok("BackSpace".to_owned()),
        "Delete" => Ok("Delete".to_owned()),
        "ArrowUp" => Ok("Up".to_owned()),
        "ArrowDown" => Ok("Down".to_owned()),
        "ArrowLeft" => Ok("Left".to_owned()),
        "ArrowRight" => Ok("Right".to_owned()),
        "Home" => Ok("Home".to_owned()),
        "End" => Ok("End".to_owned()),
        "PageUp" => Ok("Page_Up".to_owned()),
        "PageDown" => Ok("Page_Down".to_owned()),
        "Space" => Ok("space".to_owned()),
        other if is_single_ascii_alphanumeric(other) => Ok(other.to_ascii_lowercase()),
        other if is_function_key(other) => Ok(other.to_owned()),
        other => Err(DesktopControlError::new(format!(
            "unsupported key: {other}"
        ))),
    }
}

fn is_single_ascii_alphanumeric(value: &str) -> bool {
    let mut chars = value.chars();
    match (chars.next(), chars.next()) {
        (Some(ch), None) => ch.is_ascii_alphanumeric(),
        _ => false,
    }
}

fn is_function_key(value: &str) -> bool {
    let Some(rest) = value.strip_prefix('F') else {
        return false;
    };
    match rest.parse::<u8>() {
        Ok(number) => (1..=12).contains(&number),
        Err(_) => false,
    }
}
