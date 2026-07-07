use crate::desktop_control_native::{
    DesktopControlError, HotkeyRequest, HotkeyResponse, KeyRequest, KeyResponse, TypeTextRequest,
    TypeTextResponse,
};

pub fn type_text(request: TypeTextRequest) -> Result<TypeTextResponse, DesktopControlError> {
    run_send_keys(send_keys_text(&request.text))?;
    Ok(TypeTextResponse {
        success: true,
        mode: "text",
        text_length: request.text.chars().count(),
        driver: super::powershell_driver(),
    })
}

pub fn key(request: KeyRequest) -> Result<KeyResponse, DesktopControlError> {
    run_send_keys(send_keys_key(&request.key)?)?;
    Ok(KeyResponse {
        success: true,
        mode: "key",
        key: request.key,
        driver: super::powershell_driver(),
    })
}

pub fn hotkey(request: HotkeyRequest) -> Result<HotkeyResponse, DesktopControlError> {
    if request.keys.len() < 2 {
        return Err(DesktopControlError::new(
            "hotkey requires at least one modifier and one key",
        ));
    }
    let main = send_keys_key(&request.keys[request.keys.len() - 1])?;
    let mut sequence = String::new();
    for modifier in &request.keys[..request.keys.len() - 1] {
        sequence.push_str(send_keys_modifier(modifier)?);
    }
    sequence.push_str(&main);
    run_send_keys(sequence)?;
    Ok(HotkeyResponse {
        success: true,
        mode: "hotkey",
        keys: request.keys,
        driver: super::powershell_driver(),
    })
}

fn run_send_keys(sequence: String) -> Result<(), DesktopControlError> {
    super::run_powershell(format!(
        "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait({})",
        super::ps_string(&sequence)
    ))
}

fn send_keys_modifier(value: &str) -> Result<&'static str, DesktopControlError> {
    match value {
        "Control" | "Ctrl" => Ok("^"),
        "Alt" | "Option" => Ok("%"),
        "Shift" => Ok("+"),
        "Meta" | "Command" | "Cmd" => Err(DesktopControlError::new(
            "Windows SendKeys driver does not support Meta/Windows hotkey",
        )),
        _ => Err(DesktopControlError::new(format!(
            "unsupported hotkey modifier: {value}"
        ))),
    }
}

fn send_keys_key(value: &str) -> Result<String, DesktopControlError> {
    match value {
        "Enter" => Ok("{ENTER}".to_owned()),
        "Tab" => Ok("{TAB}".to_owned()),
        "Escape" => Ok("{ESC}".to_owned()),
        "Backspace" => Ok("{BACKSPACE}".to_owned()),
        "Delete" => Ok("{DELETE}".to_owned()),
        "ArrowUp" => Ok("{UP}".to_owned()),
        "ArrowDown" => Ok("{DOWN}".to_owned()),
        "ArrowLeft" => Ok("{LEFT}".to_owned()),
        "ArrowRight" => Ok("{RIGHT}".to_owned()),
        "Home" => Ok("{HOME}".to_owned()),
        "End" => Ok("{END}".to_owned()),
        "PageUp" => Ok("{PGUP}".to_owned()),
        "PageDown" => Ok("{PGDN}".to_owned()),
        "Space" => Ok(" ".to_owned()),
        other if is_single_ascii_alphanumeric(other) => Ok(other.to_ascii_lowercase()),
        other => Err(DesktopControlError::new(format!("unsupported key: {other}"))),
    }
}

fn send_keys_text(value: &str) -> String {
    value
        .chars()
        .map(send_keys_char)
        .collect::<Vec<_>>()
        .join("")
}

fn send_keys_char(ch: char) -> String {
    match ch {
        '\n' => "{ENTER}".to_owned(),
        '\t' => "{TAB}".to_owned(),
        '+' | '^' | '%' | '~' | '(' | ')' | '[' | ']' | '{' | '}' => format!("{{{ch}}}"),
        other => other.to_string(),
    }
}

fn is_single_ascii_alphanumeric(value: &str) -> bool {
    let mut chars = value.chars();
    match (chars.next(), chars.next()) {
        (Some(ch), None) => ch.is_ascii_alphanumeric(),
        _ => false,
    }
}
