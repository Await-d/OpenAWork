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

pub enum DesktopControlAction {
    Screenshot(ScreenshotRequest),
    Click(ClickRequest),
    TypeText(TypeTextRequest),
    Key(KeyRequest),
    Hotkey(HotkeyRequest),
    Scroll(ScrollRequest),
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

fn default_mouse_button() -> MouseButton {
    MouseButton::Left
}

fn default_click_action() -> ClickAction {
    ClickAction::Click
}

fn default_wait_ms() -> u64 {
    2_000
}
