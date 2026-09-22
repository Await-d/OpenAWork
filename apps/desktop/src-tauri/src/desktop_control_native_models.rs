use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopControlStatus {
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub capabilities: DesktopControlCapabilities,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopControlCapabilities {
    pub screenshot: DesktopControlCapability,
    pub click: DesktopControlCapability,
    pub type_text: DesktopControlCapability,
    pub key: DesktopControlCapability,
    pub hotkey: DesktopControlCapability,
    pub scroll: DesktopControlCapability,
    pub drag: DesktopControlCapability,
    pub mouse_move: DesktopControlCapability,
    pub long_press: DesktopControlCapability,
    pub wait: DesktopControlCapability,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopControlCapability {
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub driver: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl DesktopControlCapability {
    pub fn available(driver: &str) -> Self {
        Self {
            available: true,
            driver: Some(driver.to_owned()),
            reason: None,
        }
    }

    pub fn unavailable(reason: &str) -> Self {
        Self {
            available: false,
            driver: None,
            reason: Some(reason.to_owned()),
        }
    }
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MouseButton {
    Left,
    Right,
    Middle,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ClickAction {
    Click,
    DoubleClick,
    Down,
    Up,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotRequest {
    #[serde(default)]
    pub delay_ms: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClickRequest {
    pub x: f64,
    pub y: f64,
    #[serde(default = "default_mouse_button")]
    pub button: MouseButton,
    #[serde(default = "default_click_action", rename = "action")]
    pub click_action: ClickAction,
}

#[derive(Deserialize)]
pub struct TypeTextRequest {
    pub text: String,
}

#[derive(Deserialize)]
pub struct KeyRequest {
    pub key: String,
}

#[derive(Deserialize)]
pub struct HotkeyRequest {
    pub keys: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrollRequest {
    #[serde(default)]
    pub x: Option<f64>,
    #[serde(default)]
    pub y: Option<f64>,
    #[serde(default)]
    pub scroll_x: f64,
    #[serde(default)]
    pub scroll_y: f64,
}

#[derive(Deserialize)]
pub struct WaitRequest {
    #[serde(default = "default_wait_ms")]
    pub ms: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DragRequest {
    pub from_x: f64,
    pub from_y: f64,
    pub to_x: f64,
    pub to_y: f64,
    #[serde(default = "default_mouse_button")]
    pub button: MouseButton,
    #[serde(default = "default_drag_ms")]
    pub ms: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MouseMoveRequest {
    pub x: f64,
    pub y: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LongPressRequest {
    pub x: f64,
    pub y: f64,
    #[serde(default = "default_mouse_button")]
    pub button: MouseButton,
    #[serde(default = "default_long_press_ms")]
    pub ms: u64,
}

pub enum DesktopControlAction {
    Screenshot(ScreenshotRequest),
    Click(ClickRequest),
    TypeText(TypeTextRequest),
    Key(KeyRequest),
    Hotkey(HotkeyRequest),
    Scroll(ScrollRequest),
    Drag(DragRequest),
    MouseMove(MouseMoveRequest),
    LongPress(LongPressRequest),
    Wait(WaitRequest),
}

#[derive(Serialize)]
#[serde(untagged)]
pub enum DesktopControlActionResponse {
    Screenshot(ScreenshotResponse),
    Click(ClickResponse),
    TypeText(TypeTextResponse),
    Key(KeyResponse),
    Hotkey(HotkeyResponse),
    Scroll(ScrollResponse),
    Drag(DragResponse),
    MouseMove(MouseMoveResponse),
    LongPress(LongPressResponse),
    Wait(WaitResponse),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotResponse {
    pub success: bool,
    pub media_type: &'static str,
    pub data: String,
    pub byte_length: usize,
    pub driver: String,
}

#[derive(Serialize)]
pub struct ClickResponse {
    pub success: bool,
    pub x: f64,
    pub y: f64,
    pub button: MouseButton,
    pub action: ClickAction,
    pub driver: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeTextResponse {
    pub success: bool,
    pub mode: &'static str,
    pub text_length: usize,
    pub driver: String,
}

#[derive(Serialize)]
pub struct KeyResponse {
    pub success: bool,
    pub mode: &'static str,
    pub key: String,
    pub driver: String,
}

#[derive(Serialize)]
pub struct HotkeyResponse {
    pub success: bool,
    pub mode: &'static str,
    pub keys: Vec<String>,
    pub driver: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrollResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
    pub scroll_x: f64,
    pub scroll_y: f64,
    pub driver: String,
}

#[derive(Serialize)]
pub struct WaitResponse {
    pub success: bool,
    pub ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DragResponse {
    pub success: bool,
    pub from_x: f64,
    pub from_y: f64,
    pub to_x: f64,
    pub to_y: f64,
    pub button: MouseButton,
    pub driver: String,
}

#[derive(Serialize)]
pub struct MouseMoveResponse {
    pub success: bool,
    pub x: f64,
    pub y: f64,
    pub driver: String,
}

#[derive(Serialize)]
pub struct LongPressResponse {
    pub success: bool,
    pub x: f64,
    pub y: f64,
    pub button: MouseButton,
    pub ms: u64,
    pub driver: String,
}

fn default_mouse_button() -> MouseButton {
    MouseButton::Left
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn drag_request_accepts_camel_case_and_defaults_button_and_ms() {
        let request: DragRequest =
            serde_json::from_value(json!({ "fromX": 1.0, "fromY": 2.0, "toX": 3.0, "toY": 4.0 }))
                .expect("camelCase drag request should deserialize");
        assert!(matches!(request.button, MouseButton::Left));
        assert_eq!(request.ms, 300);
    }

    #[test]
    fn long_press_request_defaults_button_and_ms() {
        let request: LongPressRequest = serde_json::from_value(json!({ "x": 5.0, "y": 6.0 }))
            .expect("long_press request should deserialize with defaults");
        assert!(matches!(request.button, MouseButton::Left));
        assert_eq!(request.ms, 800);
    }

    #[test]
    fn mouse_move_request_requires_both_coordinates() {
        assert!(serde_json::from_value::<MouseMoveRequest>(json!({ "x": 1.0 })).is_err());
        assert!(serde_json::from_value::<MouseMoveRequest>(json!({ "y": 1.0 })).is_err());
    }

    /// 契约测试：响应必须序列化成 camelCase（`fromX` 而非 `from_x`），
    /// 网关侧 `desktop-control.ts` 按 camelCase 读取这些字段，改回 snake_case 会静默丢值。
    #[test]
    fn drag_response_serializes_to_camel_case() {
        let value = serde_json::to_value(DragResponse {
            success: true,
            from_x: 1.0,
            from_y: 2.0,
            to_x: 3.0,
            to_y: 4.0,
            button: MouseButton::Left,
            driver: "test".to_owned(),
        })
        .expect("drag response should serialize");

        for key in ["success", "fromX", "fromY", "toX", "toY", "button", "driver"] {
            assert!(value.get(key).is_some(), "缺少 camelCase 字段 {key}");
        }
        assert!(value.get("from_x").is_none(), "不应出现 snake_case 字段 from_x");
    }

    #[test]
    fn scroll_response_keeps_camel_case_contract() {
        let value = serde_json::to_value(ScrollResponse {
            success: true,
            x: None,
            y: None,
            scroll_x: 10.0,
            scroll_y: 20.0,
            driver: "test".to_owned(),
        })
        .expect("scroll response should serialize");

        assert!(value.get("scrollX").is_some());
        assert!(value.get("scrollY").is_some());
    }

    /// 契约测试：能力位必须序列化成 camelCase，网关 `desktopControlCapabilitiesSchema` 按此读取。
    #[test]
    fn capabilities_serialize_to_camel_case() {
        let capability = DesktopControlCapability::available("test");
        let value = serde_json::to_value(DesktopControlCapabilities {
            screenshot: capability.clone(),
            click: capability.clone(),
            type_text: capability.clone(),
            key: capability.clone(),
            hotkey: capability.clone(),
            scroll: capability.clone(),
            wait: capability.clone(),
            drag: capability.clone(),
            mouse_move: capability.clone(),
            long_press: capability,
        })
        .expect("capabilities should serialize");

        for key in ["mouseMove", "longPress", "drag", "typeText"] {
            assert!(value.get(key).is_some(), "缺少 camelCase 能力位 {key}");
        }
    }
}


fn default_click_action() -> ClickAction {
    ClickAction::Click
}

fn default_wait_ms() -> u64 {
    2_000
}

fn default_drag_ms() -> u64 {
    300
}

fn default_long_press_ms() -> u64 {
    800
}
