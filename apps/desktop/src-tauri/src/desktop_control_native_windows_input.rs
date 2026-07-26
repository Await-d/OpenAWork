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
    let main_key = hotkey_virtual_key(&request.keys[request.keys.len() - 1])?;
    let modifier_keys = request.keys[..request.keys.len() - 1]
        .iter()
        .map(|modifier| hotkey_modifier_virtual_key(modifier))
        .collect::<Result<Vec<_>, _>>()?;
    run_virtual_hotkey(&modifier_keys, main_key)?;
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

fn run_virtual_hotkey(modifiers: &[u16], main_key: u16) -> Result<(), DesktopControlError> {
    super::run_powershell(build_virtual_hotkey_script(modifiers, main_key))
}

fn build_virtual_hotkey_script(modifiers: &[u16], main_key: u16) -> String {
    let mut script = keyboard_bridge_type();
    for modifier in modifiers {
        script.push_str(&keyboard_event_script(*modifier, false));
    }
    script.push_str(&keyboard_event_script(main_key, false));
    script.push_str(&keyboard_event_script(main_key, true));
    for modifier in modifiers.iter().rev() {
        script.push_str(&keyboard_event_script(*modifier, true));
    }
    script
}

fn keyboard_bridge_type() -> String {
    "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; \
     public static class KeyboardBridge { \
     [DllImport(\"user32.dll\", SetLastError=true)] \
     public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo); \
     }';"
        .to_owned()
}

fn keyboard_event_script(virtual_key: u16, key_up: bool) -> String {
    let flags = if key_up { "0x0002" } else { "0" };
    format!(" [KeyboardBridge]::keybd_event(0x{virtual_key:02X},0,{flags},[UIntPtr]::Zero);")
}

fn hotkey_modifier_virtual_key(value: &str) -> Result<u16, DesktopControlError> {
    match normalized_input(value).as_str() {
        "control" | "ctrl" => Ok(0x11),
        "alt" | "option" => Ok(0x12),
        "shift" => Ok(0x10),
        "meta" | "command" | "cmd" | "super" | "win" | "windows" => Ok(0x5B),
        _ => Err(DesktopControlError::new(format!(
            "unsupported hotkey modifier: {value}"
        ))),
    }
}

fn hotkey_virtual_key(value: &str) -> Result<u16, DesktopControlError> {
    match normalized_input(value).as_str() {
        "enter" => Ok(0x0D),
        "tab" => Ok(0x09),
        "escape" | "esc" => Ok(0x1B),
        "backspace" => Ok(0x08),
        "delete" => Ok(0x2E),
        "arrowup" | "up" => Ok(0x26),
        "arrowdown" | "down" => Ok(0x28),
        "arrowleft" | "left" => Ok(0x25),
        "arrowright" | "right" => Ok(0x27),
        "home" => Ok(0x24),
        "end" => Ok(0x23),
        "pageup" => Ok(0x21),
        "pagedown" => Ok(0x22),
        "space" => Ok(0x20),
        other if is_single_ascii_alphanumeric(other) => {
            let ch = other.chars().next().expect("single ascii alphanumeric");
            Ok(ch.to_ascii_uppercase() as u16)
        }
        other => function_key_virtual_key(other)
            .ok_or_else(|| DesktopControlError::new(format!("unsupported key: {value}"))),
    }
}

fn send_keys_key(value: &str) -> Result<String, DesktopControlError> {
    match normalized_input(value).as_str() {
        "enter" => Ok("{ENTER}".to_owned()),
        "tab" => Ok("{TAB}".to_owned()),
        "escape" | "esc" => Ok("{ESC}".to_owned()),
        "backspace" => Ok("{BACKSPACE}".to_owned()),
        "delete" => Ok("{DELETE}".to_owned()),
        "arrowup" | "up" => Ok("{UP}".to_owned()),
        "arrowdown" | "down" => Ok("{DOWN}".to_owned()),
        "arrowleft" | "left" => Ok("{LEFT}".to_owned()),
        "arrowright" | "right" => Ok("{RIGHT}".to_owned()),
        "home" => Ok("{HOME}".to_owned()),
        "end" => Ok("{END}".to_owned()),
        "pageup" => Ok("{PGUP}".to_owned()),
        "pagedown" => Ok("{PGDN}".to_owned()),
        "space" => Ok(" ".to_owned()),
        other if is_single_ascii_alphanumeric(other) => Ok(other.to_ascii_lowercase()),
        other if function_key_virtual_key(other).is_some() => {
            Ok(format!("{{{}}}", other.to_ascii_uppercase()))
        }
        other => Err(DesktopControlError::new(format!(
            "unsupported key: {other}"
        ))),
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

fn normalized_input(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn function_key_virtual_key(value: &str) -> Option<u16> {
    let digits = value.strip_prefix('f')?;
    let number = digits.parse::<u16>().ok()?;
    if !(1..=24).contains(&number) {
        return None;
    }
    Some(0x70 + number - 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hotkey_modifier_accepts_windows_aliases_case_insensitively() {
        assert_eq!(hotkey_modifier_virtual_key("win").unwrap(), 0x5B);
        assert_eq!(hotkey_modifier_virtual_key("Windows").unwrap(), 0x5B);
        assert_eq!(hotkey_modifier_virtual_key("SUPER").unwrap(), 0x5B);
    }

    #[test]
    fn send_keys_key_accepts_lowercase_named_keys() {
        assert_eq!(send_keys_key("enter").unwrap(), "{ENTER}");
        assert_eq!(send_keys_key("pagedown").unwrap(), "{PGDN}");
        assert_eq!(send_keys_key("f5").unwrap(), "{F5}");
    }

    #[test]
    fn virtual_hotkey_script_presses_main_key_between_modifier_down_and_up() {
        let script = build_virtual_hotkey_script(&[0x5B], 0x52);
        let win_down = script.find("0x5B,0,0,").unwrap();
        let r_down = script.find("0x52,0,0,").unwrap();
        let r_up = script.find("0x52,0,0x0002,").unwrap();
        let win_up = script.rfind("0x5B,0,0x0002,").unwrap();

        assert!(win_down < r_down);
        assert!(r_down < r_up);
        assert!(r_up < win_up);
    }
}
