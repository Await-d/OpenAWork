use argon2::password_hash::{rand_core::OsRng as ArgonRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, State, WindowEvent, Wry};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, ShortcutState};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_updater::UpdaterExt;

/// 桌面端统一根目录（存放 desktop-settings.json 与默认 agent-gateway 数据）。
///
/// 用户已明确要求把所有持久化集中到 `~/.openAwork/`。该目录本身**始终在**
/// home dir，不随 `data_root` 设置迁移——它是 bootstrap 入口，先读它才能
/// 拿到自定义的 data_root；否则会出现先有蛋还是先有鸡的问题。
const DESKTOP_HOME_FOLDER: &str = ".openAwork";
const DESKTOP_SETTINGS_FILE: &str = "desktop-settings.json";
/// gateway 子目录名（在 effective data_root 下）。与 storage-paths.ts 中的
/// `DEFAULT_GATEWAY_DATA_SUBDIR` 对齐。
const GATEWAY_SUBDIR: &str = "agent-gateway";

struct GatewayState {
    child: Option<CommandChild>,
    port: Option<u16>,
    generation: u64,
    desktop_auth_token: String,
}

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopTokenPair {
    access_token: String,
    refresh_token: String,
    expires_in: String,
}

struct GatewayProcess(Arc<Mutex<GatewayState>>);

impl Drop for GatewayProcess {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(child) = guard.child.take() {
                let _ = child.kill();
            }
            guard.port = None;
        }
    }
}

fn generate_desktop_auth_token() -> String {
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn clear_gateway_child(gateway_state: &Arc<Mutex<GatewayState>>, generation: u64) {
    if let Ok(mut guard) = gateway_state.lock() {
        if guard.generation == generation {
            guard.child = None;
            guard.port = None;
        }
    }
}

/// 用户对关闭按钮的行为偏好（持久化到 `settings.json`）。
#[derive(Default, Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum CloseBehavior {
    /// 每次都弹对话框询问（默认）。
    #[default]
    Ask,
    /// 直接最小化到托盘。
    Minimize,
    /// 直接退出应用。
    Exit,
}

/// Tauri 事件名：解锁状态变更时 emit，前端 UnlockOverlay 据此显示/隐藏。
///
/// payload = `LockStateView`。
const EVT_LOCK_STATE_CHANGED: &str = "lock-state-changed";

/// gateway sidecar 健康状态——驱动托盘 tooltip emoji 与前端状态显示。
///
/// 状态机：Stopped → Starting → Healthy → Restarting → (Healthy | Failed)。
/// `Restarting` 暂保留供未来 Rust 侧自动重启使用；目前由前端在收到 `gateway:crashed`
/// 后处理重启流程。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
#[allow(dead_code)]
enum GatewayHealth {
    Stopped,
    Starting,
    Healthy,
    Restarting,
    Failed,
}

impl GatewayHealth {
    /// 托盘 tooltip 文案，`emoji + 中文描述`。
    fn tooltip(self) -> &'static str {
        match self {
            Self::Stopped => "⚪ OpenAWork · 网关已停止",
            Self::Starting => "🟡 OpenAWork · 网关启动中",
            Self::Healthy => "🟢 OpenAWork · 网关运行中",
            Self::Restarting => "🟡 OpenAWork · 网关重启中",
            Self::Failed => "🔴 OpenAWork · 网关异常，请检查",
        }
    }
}

/// 当前 gateway 健康状态（managed by Tauri，托盘 tooltip 与事件驱动方）。
struct GatewayHealthState(Arc<Mutex<GatewayHealth>>);

/// 桌面端持久化设置。以 JSON 形式保存到 `~/.openAwork/desktop-settings.json`。
///
/// 旧版本曾使用 `app_config_dir()/settings.json`（即 `%APPDATA%\com.openAwork.desktop\`），
/// 启动时 `load_settings` 会自动把旧文件迁移到新位置，用户无感。
#[derive(Default, Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct PersistedSettings {
    close_behavior: CloseBehavior,
    /// 用户是否见过"已最小化到托盘"的系统通知（避免反复打扰）。
    has_seen_tray_hint: bool,
    /// 用户自定义的「数据根目录」。`None` = 使用默认 `~/.openAwork/`。
    /// gateway sidecar 的 `OPENAWORK_DATA_DIR` 会被设置为 `<data_root>/agent-gateway`。
    #[serde(default)]
    data_root: Option<PathBuf>,
    /// 解锁 PIN 的 argon2id 哈希（PHC 字符串格式，含盐）。`None` = 未设 PIN。
    #[serde(default)]
    pin_hash: Option<String>,
    /// 空闲自动锁屏的间隔分钟。`None` 或 `Some(0)` = 禁用。
    /// 前端负责监听键鼠活动与计时，超过时调 `lock_desktop_now` 。
    #[serde(default)]
    idle_lock_minutes: Option<u32>,
}

/// 暴露给前端的设置视图——把 effective 路径与 autostart/pin 状态一起返回，
/// 便于设置界面一次性渲染所有桌面端配置。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopSettingsView {
    close_behavior: CloseBehavior,
    has_seen_tray_hint: bool,
    /// 当前生效的数据根目录绝对路径（已展开 ~ / 默认值）。
    effective_data_root: String,
    /// 用户显式设置的 data_root；`None` 表示走默认值。
    custom_data_root: Option<String>,
    /// 默认数据根目录（即 `~/.openAwork/`）路径，便于前端展示「重置默认」按钮。
    default_data_root: String,
    /// 设置文件的绝对路径（`~/.openAwork/desktop-settings.json`），便于前端展示。
    settings_file_path: String,
    /// 当前 autostart 是否启用（来自系统 API，不是缓存）。
    autostart_enabled: bool,
    /// 是否已设置解锁 PIN。
    has_pin: bool,
    /// 空闲自动锁分钟。`None` / `0` 表示禁用。
    idle_lock_minutes: Option<u32>,
    /// PIN 长度（格子数），前后端统一，前端 PinInput 按此渲染。
    pin_digits: usize,
}

/// 前端读解锁状态用的视图。
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LockStateView {
    /// 当前窗口是否处于锁定状态（需要输 PIN 才能继续使用）。
    locked: bool,
    /// 是否配置了 PIN。`false` 时 `locked` 用不上，前端直接显示主界面。
    has_pin: bool,
}

/// 前端可更新的字段（PATCH 风格）。任意字段为 `None` 表示不修改。
///
/// `idle_lock_minutes` 特殊语义：`Some(Some(n))` 设为分钟数（`n=0` 为禁用），
/// `Some(None)` 显式置为禁用，`None` 表示不修改该字段。
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct DesktopSettingsPatch {
    close_behavior: Option<CloseBehavior>,
    has_seen_tray_hint: Option<bool>,
    #[serde(default, deserialize_with = "deserialize_opt_opt_u32")]
    idle_lock_minutes: Option<Option<u32>>,
}

/// 区分前端传 `null`（显式重置）与字段缺失（不修改）。serde 默认无法
/// 区分 `Some(None)` 与字段缺失，这里自定义反序列化 hook。
fn deserialize_opt_opt_u32<'de, D>(d: D) -> Result<Option<Option<u32>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<Option<u32>>::deserialize(d)
}

/// 全局设置状态（managed by Tauri）。
struct SettingsState(Arc<Mutex<PersistedSettings>>);

/// 锁屏状态与防暴力计数。内存态，不持久化。
///
/// 触发锁定的时机：
/// - 启动后：若 PersistedSettings.pin_hash.is_some() 则 `locked = true`；
/// - 隐藏到托盘：若有 pin 则 lock；
/// - 用户输对 PIN：`locked = false`。
#[derive(Debug)]
struct LockInner {
    /// 当前窗口是否锁定。
    locked: bool,
    /// 连续错误次数（达到阈值则触发锁死，解锁后清零）。
    failed_attempts: u32,
    /// 锁死截止时间。`Some(t)` 且当前时间 < t 时拒绝任何验证尝试。
    locked_until: Option<Instant>,
}

impl Default for LockInner {
    fn default() -> Self {
        Self {
            locked: false,
            failed_attempts: 0,
            locked_until: None,
        }
    }
}

struct LockState(Arc<Mutex<LockInner>>);

/// PIN 错误次数达到此阈值 → 锁死 `PIN_LOCKOUT_DURATION`。
const PIN_MAX_ATTEMPTS: u32 = 5;
/// 锁死时长（3 分钟）。
const PIN_LOCKOUT_DURATION: Duration = Duration::from_secs(3 * 60);

/// 解析桌面端根目录 `~/.openAwork/`。home_dir 拿不到时回退到 `app_config_dir()`，
/// 防止 CI / 容器等无 HOME 环境变量场景直接 panic。
fn desktop_home_dir(app: &tauri::AppHandle) -> PathBuf {
    if let Some(home) = dirs::home_dir() {
        return home.join(DESKTOP_HOME_FOLDER);
    }
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(DESKTOP_HOME_FOLDER)
}

/// 默认数据根目录（即 `~/.openAwork/`，与 `desktop_home_dir` 一致）。
/// 用户未自定义 `data_root` 时使用此值。
fn default_data_root(app: &tauri::AppHandle) -> PathBuf {
    desktop_home_dir(app)
}

/// 当前生效的数据根目录：自定义优先，否则取默认。
fn effective_data_root(app: &tauri::AppHandle, settings: &PersistedSettings) -> PathBuf {
    settings
        .data_root
        .clone()
        .unwrap_or_else(|| default_data_root(app))
}

/// gateway sidecar 真正落盘的目录：`<effective_data_root>/agent-gateway`。
fn gateway_data_dir(app: &tauri::AppHandle, settings: &PersistedSettings) -> PathBuf {
    effective_data_root(app, settings).join(GATEWAY_SUBDIR)
}

/// 旧版本的 settings.json 位置（`app_config_dir()/settings.json`），仅用于一次性迁移。
fn legacy_settings_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("settings.json"))
}

/// 托盘菜单中需要动态更新 checked 状态的菜单项句柄。
struct TrayMenuHandles {
    cb_ask: CheckMenuItem<Wry>,
    cb_minimize: CheckMenuItem<Wry>,
    cb_exit: CheckMenuItem<Wry>,
    autostart: CheckMenuItem<Wry>,
}

/// 当前的 settings.json 路径：`~/.openAwork/desktop-settings.json`。
fn settings_file(app: &tauri::AppHandle) -> PathBuf {
    desktop_home_dir(app).join(DESKTOP_SETTINGS_FILE)
}

/// 读取桌面端持久化设置。
///
/// 迁移逻辑（仅触发一次）：如果 `~/.openAwork/desktop-settings.json` 不存在，
/// 但旧位置 `app_config_dir()/settings.json` 存在，则把内容拷贝到新位置
/// 并删除旧文件。失败时静默回退到 default，避免阻塞应用启动。
fn load_settings(app: &tauri::AppHandle) -> PersistedSettings {
    let new_path = settings_file(app);

    // 先尝试新位置。
    if let Ok(content) = fs::read_to_string(&new_path) {
        if let Ok(parsed) = serde_json::from_str::<PersistedSettings>(&content) {
            return parsed;
        }
    }

    // 新位置缺失或损坏 —— 看旧位置能否抢救。
    if let Some(legacy) = legacy_settings_file(app) {
        if legacy.exists() {
            if let Ok(content) = fs::read_to_string(&legacy) {
                if let Ok(parsed) = serde_json::from_str::<PersistedSettings>(&content) {
                    if let Some(parent) = new_path.parent() {
                        let _ = fs::create_dir_all(parent);
                    }
                    let _ = fs::write(&new_path, &content);
                    let _ = fs::remove_file(&legacy);
                    return parsed;
                }
            }
        }
    }

    PersistedSettings::default()
}

fn save_settings(app: &tauri::AppHandle, settings: &PersistedSettings) {
    let path = settings_file(app);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(settings) {
        let _ = fs::write(&path, json);
    }
}

/// 读取当前关闭行为（带默认兜底）。
fn read_close_behavior(app: &tauri::AppHandle) -> CloseBehavior {
    app.try_state::<SettingsState>()
        .and_then(|state| state.0.lock().ok().map(|guard| guard.close_behavior))
        .unwrap_or_default()
}

/// 更新关闭行为：写 state、持久化到磁盘、同步刷新托盘菜单 checked。
fn apply_close_behavior(app: &tauri::AppHandle, behavior: CloseBehavior) {
    if let Some(state) = app.try_state::<SettingsState>() {
        if let Ok(mut guard) = state.0.lock() {
            guard.close_behavior = behavior;
            save_settings(app, &guard);
        }
    }
    if let Some(handles) = app.try_state::<TrayMenuHandles>() {
        let _ = handles.cb_ask.set_checked(behavior == CloseBehavior::Ask);
        let _ = handles
            .cb_minimize
            .set_checked(behavior == CloseBehavior::Minimize);
        let _ = handles.cb_exit.set_checked(behavior == CloseBehavior::Exit);
    }
}

/// 查询开机自启当前状态（失败时视为 false）。
fn autostart_enabled(app: &tauri::AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

/// 使用 argon2id 生成每次随机盐的 PHC 格式 hash 字符串。
fn hash_pin(pin: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut ArgonRng);
    Argon2::default()
        .hash_password(pin.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| format!("PIN hash failed: {e}"))
}

/// 验证用户输入 PIN 是否匹配已存储的 argon2 hash。
fn verify_pin(pin: &str, stored_hash: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(stored_hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(pin.as_bytes(), &parsed)
        .is_ok()
}

/// PIN 位数。前后端统一 6 位，确保解锁 UI 格子数与设置 UI 一致。
const PIN_DIGITS: usize = 6;

/// 校验 PIN：必须恰好 6 位纯数字。
fn validate_pin_format(pin: &str) -> Result<(), String> {
    if pin.len() != PIN_DIGITS {
        return Err(format!("PIN 须为 {PIN_DIGITS} 位数字"));
    }
    if !pin.chars().all(|c| c.is_ascii_digit()) {
        return Err("PIN 仅支持数字 0-9".to_string());
    }
    Ok(())
}

/// 读当前 lock 状态（失败时回退 false）。
fn read_locked(app: &tauri::AppHandle) -> bool {
    app.try_state::<LockState>()
        .and_then(|state| state.0.lock().ok().map(|g| g.locked))
        .unwrap_or(false)
}

/// 当前锁死剩余秒数；`0` 表示未锁死或锁死已到期。
fn pin_lockout_remaining_secs(inner: &LockInner) -> u64 {
    inner
        .locked_until
        .and_then(|t| t.checked_duration_since(Instant::now()))
        .map(|d| d.as_secs() + 1) // 该向上取整让前端看到「刺有」不至于怎么上今就 0
        .unwrap_or(0)
}

/// 读当前是否已设 PIN。
fn has_pin(app: &tauri::AppHandle) -> bool {
    app.try_state::<SettingsState>()
        .and_then(|state| state.0.lock().ok().map(|g| g.pin_hash.is_some()))
        .unwrap_or(false)
}

/// 更新 gateway 健康状态：写 state、刷新托盘 tooltip、emit 事件供前端订阅。
fn update_gateway_health(app: &tauri::AppHandle, health: GatewayHealth) {
    if let Some(state) = app.try_state::<GatewayHealthState>() {
        if let Ok(mut guard) = state.0.lock() {
            if *guard == health {
                return;
            }
            *guard = health;
        }
    }
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(health.tooltip()));
    }
    let _ = app.emit("gateway:health", health);
}

/// 设置 lock 状态并 emit 事件通知前端。解锁时同步清零错误计数。
fn set_locked(app: &tauri::AppHandle, locked: bool) {
    if let Some(state) = app.try_state::<LockState>() {
        if let Ok(mut guard) = state.0.lock() {
            guard.locked = locked;
            if !locked {
                guard.failed_attempts = 0;
                guard.locked_until = None;
            }
        }
    }
    let view = LockStateView {
        locked,
        has_pin: has_pin(app),
    };
    let _ = app.emit(EVT_LOCK_STATE_CHANGED, view);
}

/// 切换开机自启并同步刷新托盘菜单 checked。
fn apply_autostart(app: &tauri::AppHandle, enable: bool) {
    let manager = app.autolaunch();
    let _ = if enable {
        manager.enable()
    } else {
        manager.disable()
    };
    if let Some(handles) = app.try_state::<TrayMenuHandles>() {
        let _ = handles.autostart.set_checked(autostart_enabled(app));
    }
}

async fn is_local_gateway_healthy(port: u16) -> bool {
    match reqwest::Client::new()
        .get(format!("http://127.0.0.1:{port}/health"))
        .timeout(Duration::from_secs(2))
        .send()
        .await
    {
        Ok(response) => response.status().is_success(),
        Err(_) => false,
    }
}

/// 应用真正退出时清理本桌面端实例**自己启动**的 gateway sidecar 子进程。
///
/// 设计意图（"跨会话复用网关"）：
/// - 仅 kill `state.child` 是 Some 的子进程——即本进程通过 `start_gateway`
///   spawn 出来的 sidecar；
/// - 如果 `state.child` 是 None（即 `start_gateway` 时检测到端口已有健康网关
///   而**复用**了，没有接管所有权），则**不会**kill 那个网关，让它继续为
///   其他桌面端会话或独立工具提供服务。
///
/// 为什么必须保留 kill 自己 child 的逻辑：dev 模式下若不 kill，残留 node
/// 进程会持有 `sidecars/agent-gateway` 下的文件，导致下次 `pnpm dev` 时
/// bundle-sidecar 的 `rm -rf` 触发 EBUSY、Tauri build 复制资源 PermissionDenied。
fn shutdown_gateway_child(app: &tauri::AppHandle) {
    let gateway_state = app.state::<GatewayProcess>().0.clone();
    let mut guard = match gateway_state.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    guard.generation = guard.generation.wrapping_add(1);
    if let Some(child) = guard.child.take() {
        let _ = child.kill();
    }
    guard.port = None;
}

#[tauri::command]
async fn authenticate_desktop_gateway(
    state: State<'_, GatewayProcess>,
) -> Result<DesktopTokenPair, String> {
    let (port, desktop_auth_token) = {
        let guard = state.0.lock().map_err(|e| e.to_string())?;
        let port = guard.port.ok_or("Gateway is not running".to_string())?;
        (port, guard.desktop_auth_token.clone())
    };

    let response = reqwest::Client::new()
        .post(format!("http://127.0.0.1:{port}/auth/desktop-default"))
        .header("X-OpenAWork-Desktop-Auth", desktop_auth_token)
        .json(&serde_json::json!({
            "deviceName": "OpenAWork Desktop",
            "platform": "desktop",
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(response.text().await.map_err(|e| e.to_string())?);
    }

    response
        .json::<DesktopTokenPair>()
        .await
        .map_err(|e| e.to_string())
}

/// gateway sidecar spawn 的核心实现。`start_gateway` 命令与 crash watchdog 共用此函数。
///
/// 复用语义：目标端口已有健康 sidecar（本实例之前启动、独立启动的 agent-gateway）
/// → 仅登记端口，不抢 child 所有权，让进程继续服务。
async fn spawn_gateway_sidecar(app: tauri::AppHandle, port: u16) -> Result<(), String> {
    update_gateway_health(&app, GatewayHealth::Starting);

    if is_local_gateway_healthy(port).await {
        let state = app.state::<GatewayProcess>();
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        guard.port = Some(port);
        drop(guard);
        update_gateway_health(&app, GatewayHealth::Healthy);
        spawn_health_probe(&app, port);
        return Ok(());
    }

    // 在拿 GatewayProcess 锁**之前**算数据目录，避免与 SettingsState 形成锁顺序耦合。
    let data_dir = {
        let settings_state = app.state::<SettingsState>();
        let settings_guard = settings_state
            .0
            .lock()
            .map_err(|e| format!("settings lock poisoned: {e}"))?;
        gateway_data_dir(&app, &settings_guard)
    };
    let _ = fs::create_dir_all(&data_dir);

    let state = app.state::<GatewayProcess>();
    let gateway_state = state.0.clone();
    let mut guard = gateway_state.lock().map_err(|e| e.to_string())?;
    let previous_port = guard.port;
    if let Some(child) = guard.child.take() {
        let _ = child.kill();
        guard.port = None;
    }

    if previous_port == Some(port) {
        std::thread::sleep(Duration::from_millis(250));
    }

    guard.generation = guard.generation.wrapping_add(1);
    let generation = guard.generation;
    let desktop_auth_token = guard.desktop_auth_token.clone();

    // gateway 已编译为独立 Bun 二进制（binaries/agent-gateway-<triple>），
    // 无需传 entry 路径，也不依赖 node_modules，直接启动即可。
    let (mut rx, child) = app
        .shell()
        .sidecar("agent-gateway")
        .map_err(|e| e.to_string())?
        .env("GATEWAY_PORT", port.to_string())
        .env("GATEWAY_HOST", "127.0.0.1")
        .env("DESKTOP_AUTOMATION", "1")
        .env("OPENAWORK_DESKTOP_AUTH_TOKEN", desktop_auth_token)
        .env("OPENAWORK_DATA_DIR", data_dir.to_string_lossy().to_string())
        .spawn()
        .map_err(|e| e.to_string())?;

    guard.child = Some(child);
    guard.port = Some(port);
    drop(guard);

    spawn_health_probe(&app, port);

    let app_for_task = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Terminated(_) | CommandEvent::Error(_) => break,
                _ => {}
            }
        }

        // 区分「主动退出」与「崩溃」：主动退出时 stop_gateway / shutdown_gateway_child 会把
        // generation +1；崩溃时 generation 保持与 spawn 时一致。
        let crashed = {
            match gateway_state.lock() {
                Ok(guard) => guard.generation == generation,
                Err(_) => false,
            }
        };

        clear_gateway_child(&gateway_state, generation);

        if !crashed {
            // 主动退出 → 标记 Stopped；watchdog 也退出。
            update_gateway_health(&app_for_task, GatewayHealth::Stopped);
            return;
        }

        // 崩溃 → 标记 Failed 并 emit `gateway:crashed`。
        // 前端 App.tsx 的 listener 收到后会按指数退避重试 `start_gateway`，
        // 这样 Rust 侧 watchdog 不必递归调用 spawn_gateway_sidecar（async send 问题），
        // 同时也把"是否要弹 toast / 阻塞 UI"等用户交互交给 Web 层统一管理。
        update_gateway_health(&app_for_task, GatewayHealth::Failed);
        let _ = app_for_task.emit(
            "gateway:crashed",
            serde_json::json!({ "port": port }),
        );
    });

    Ok(())
}

/// 周期性 ping `/health` 探测网关健康。每 5s 一次，连续 3 次失败标记 Failed；
/// 任意一次成功立即标记 Healthy。当 `port` 不再是 GatewayProcess 当前端口（用户切端口）
/// 或网关已被 stop_gateway 主动停掉，则该 task 自然退出。
fn spawn_health_probe(app: &tauri::AppHandle, port: u16) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut consecutive_fail = 0_u32;
        loop {
            tokio::time::sleep(Duration::from_secs(5)).await;

            let still_owned = {
                match app.try_state::<GatewayProcess>() {
                    Some(state) => match state.0.lock() {
                        Ok(guard) => guard.port == Some(port),
                        Err(_) => false,
                    },
                    None => false,
                }
            };
            if !still_owned {
                // 端口已变 / sidecar 主动停掉 → 退出当前 probe，新 sidecar 启动会另起一个。
                return;
            }

            if is_local_gateway_healthy(port).await {
                consecutive_fail = 0;
                update_gateway_health(&app, GatewayHealth::Healthy);
            } else {
                consecutive_fail += 1;
                if consecutive_fail >= 3 {
                    update_gateway_health(&app, GatewayHealth::Failed);
                }
            }
        }
    });
}

#[tauri::command]
async fn start_gateway(
    port: u16,
    app: tauri::AppHandle,
    _state: State<'_, GatewayProcess>,
) -> Result<(), String> {
    spawn_gateway_sidecar(app, port).await
}

#[tauri::command]
async fn stop_gateway(
    app: tauri::AppHandle,
    state: State<'_, GatewayProcess>,
) -> Result<(), String> {
    {
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        guard.generation = guard.generation.wrapping_add(1);
        if let Some(child) = guard.child.take() {
            let _ = child.kill();
        }
        guard.port = None;
    }
    update_gateway_health(&app, GatewayHealth::Stopped);
    Ok(())
}

#[tauri::command]
async fn gateway_status(state: State<'_, GatewayProcess>) -> Result<bool, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    Ok(guard.child.is_some())
}

#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let folder = app.dialog().file().blocking_pick_folder();
    Ok(folder.map(|p| p.to_string()))
}

#[tauri::command]
async fn open_artifact_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| e.to_string())
}

/// 把 PathBuf 转为前端友好的字符串（lossy 处理非 UTF-8 字节，避免 panic）。
fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// 读取桌面端配置（含 effective 路径与 autostart 状态），供设置页一次性渲染。
#[tauri::command]
async fn get_desktop_settings(
    app: tauri::AppHandle,
    state: State<'_, SettingsState>,
) -> Result<DesktopSettingsView, String> {
    let snapshot = state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    let custom = snapshot.data_root.as_ref().map(|p| path_to_string(p));
    let effective = effective_data_root(&app, &snapshot);
    let default_root = default_data_root(&app);
    let settings_path = settings_file(&app);
    Ok(DesktopSettingsView {
        close_behavior: snapshot.close_behavior,
        has_seen_tray_hint: snapshot.has_seen_tray_hint,
        effective_data_root: path_to_string(&effective),
        custom_data_root: custom,
        default_data_root: path_to_string(&default_root),
        settings_file_path: path_to_string(&settings_path),
        autostart_enabled: autostart_enabled(&app),
        has_pin: snapshot.pin_hash.is_some(),
        idle_lock_minutes: snapshot.idle_lock_minutes,
        pin_digits: PIN_DIGITS,
    })
}

/// 设置解锁 PIN。若已有 PIN，需要在 `current_pin` 传入旧 PIN 验证。首次设置则留空。
#[tauri::command]
async fn set_desktop_pin(
    app: tauri::AppHandle,
    pin: String,
    current_pin: Option<String>,
) -> Result<DesktopSettingsView, String> {
    validate_pin_format(&pin)?;

    {
        let settings_state = app.state::<SettingsState>();
        let mut guard = settings_state.0.lock().map_err(|e| e.to_string())?;

        // 已设 PIN：必须先校验旧 PIN 才能改。
        if let Some(existing) = guard.pin_hash.as_ref() {
            let current = current_pin.unwrap_or_default();
            if current.is_empty() || !verify_pin(&current, existing) {
                return Err("当前 PIN 校验失败".to_string());
            }
        }

        guard.pin_hash = Some(hash_pin(&pin)?);
        save_settings(&app, &guard);
    }

    // 新设 PIN 成功 —— 设定已解锁状态，前端不会立刻被锁出去。
    set_locked(&app, false);
    let state = app.state::<SettingsState>();
    get_desktop_settings(app.clone(), state).await
}

/// 移除 PIN（关闭锁屏功能）。必须传入当前正确的 PIN。
#[tauri::command]
async fn remove_desktop_pin(
    app: tauri::AppHandle,
    current_pin: String,
) -> Result<DesktopSettingsView, String> {
    {
        let settings_state = app.state::<SettingsState>();
        let mut guard = settings_state.0.lock().map_err(|e| e.to_string())?;
        let Some(existing) = guard.pin_hash.clone() else {
            return Err("当前未设置 PIN".to_string());
        };
        if !verify_pin(&current_pin, &existing) {
            return Err("PIN 不正确".to_string());
        }
        guard.pin_hash = None;
        save_settings(&app, &guard);
    }

    set_locked(&app, false);
    let state = app.state::<SettingsState>();
    get_desktop_settings(app.clone(), state).await
}

/// PIN 验证结果。`ok=true` 表示解锁成功；否则结合 `lockout_seconds` 和
/// `attempts_remaining` 告知前端该显示「错误」还是「已锁死」。
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct VerifyPinResult {
    ok: bool,
    /// `Some(secs)` 表示当前或刚触发锁死；前端应禁用输入框 + 倒计时。
    lockout_seconds: u64,
    /// 尚未锁死时——剩余尝试次数（已锁死时 = 0）。
    attempts_remaining: u32,
}

/// 验证 PIN：
/// - 如果当前锁死中 → 直接返回 `ok=false, lockout_seconds>0`，不消耗尝试次数；
/// - 成功 → 解锁 + 清零计数；
/// - 失败 → `failed_attempts+1`，到 `PIN_MAX_ATTEMPTS` 上锁 `PIN_LOCKOUT_DURATION` 并清零计数。
#[tauri::command]
async fn verify_desktop_pin(
    app: tauri::AppHandle,
    pin: String,
) -> Result<VerifyPinResult, String> {
    // 先检查当前是否处于锁死期。
    {
        let lock_state = app.state::<LockState>();
        let guard = lock_state.0.lock().map_err(|e| e.to_string())?;
        let remaining = pin_lockout_remaining_secs(&guard);
        if remaining > 0 {
            return Ok(VerifyPinResult {
                ok: false,
                lockout_seconds: remaining,
                attempts_remaining: 0,
            });
        }
    }

    let hash = {
        let state = app.state::<SettingsState>();
        let guard = state.0.lock().map_err(|e| e.to_string())?;
        match guard.pin_hash.clone() {
            Some(h) => h,
            None => {
                set_locked(&app, false);
                return Ok(VerifyPinResult {
                    ok: true,
                    lockout_seconds: 0,
                    attempts_remaining: PIN_MAX_ATTEMPTS,
                });
            }
        }
    };

    if verify_pin(&pin, &hash) {
        set_locked(&app, false);
        return Ok(VerifyPinResult {
            ok: true,
            lockout_seconds: 0,
            attempts_remaining: PIN_MAX_ATTEMPTS,
        });
    }

    // 验证失败——叠加错误计数，到阈值则触发锁死。
    let (lockout_seconds, attempts_remaining) = {
        let lock_state = app.state::<LockState>();
        let mut guard = lock_state.0.lock().map_err(|e| e.to_string())?;
        guard.failed_attempts = guard.failed_attempts.saturating_add(1);
        if guard.failed_attempts >= PIN_MAX_ATTEMPTS {
            guard.locked_until = Some(Instant::now() + PIN_LOCKOUT_DURATION);
            guard.failed_attempts = 0;
            (PIN_LOCKOUT_DURATION.as_secs(), 0)
        } else {
            (0_u64, PIN_MAX_ATTEMPTS - guard.failed_attempts)
        }
    };

    Ok(VerifyPinResult {
        ok: false,
        lockout_seconds,
        attempts_remaining,
    })
}

/// 查询当前锁定状态（供前端挂载时决定是否立刻展示 UnlockOverlay）。
#[tauri::command]
async fn get_lock_state(app: tauri::AppHandle) -> Result<LockStateView, String> {
    Ok(LockStateView {
        locked: read_locked(&app),
        has_pin: has_pin(&app),
    })
}

/// PATCH 桌面端非数据根目录字段。修改 close_behavior 时同步刷新托盘菜单。
#[tauri::command]
async fn update_desktop_settings(
    app: tauri::AppHandle,
    patch: DesktopSettingsPatch,
) -> Result<DesktopSettingsView, String> {
    if let Some(behavior) = patch.close_behavior {
        // apply_close_behavior 内部会写盘 + 刷新托盘 checked。
        apply_close_behavior(&app, behavior);
    }
    if let Some(seen) = patch.has_seen_tray_hint {
        if let Some(state) = app.try_state::<SettingsState>() {
            if let Ok(mut guard) = state.0.lock() {
                guard.has_seen_tray_hint = seen;
                save_settings(&app, &guard);
            }
        }
    }
    if let Some(idle) = patch.idle_lock_minutes {
        if let Some(state) = app.try_state::<SettingsState>() {
            if let Ok(mut guard) = state.0.lock() {
                // `Some(0)` 也视为禁用（与 `None` 等效），统一存为 `None` 防止歧义。
                guard.idle_lock_minutes = match idle {
                    Some(n) if n > 0 => Some(n),
                    _ => None,
                };
                save_settings(&app, &guard);
            }
        }
    }
    let state = app.state::<SettingsState>();
    get_desktop_settings(app.clone(), state).await
}

/// 前端检测到用户空闲超时时调用：如已设 PIN 则锁定窗口。未设 PIN 时为 no-op。
#[tauri::command]
async fn lock_desktop_now(app: tauri::AppHandle) -> Result<LockStateView, String> {
    if has_pin(&app) {
        set_locked(&app, true);
    }
    Ok(LockStateView {
        locked: read_locked(&app),
        has_pin: has_pin(&app),
    })
}

/// 切换开机自启，返回最新视图。
#[tauri::command]
async fn set_autostart_enabled(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<DesktopSettingsView, String> {
    apply_autostart(&app, enabled);
    let state = app.state::<SettingsState>();
    get_desktop_settings(app.clone(), state).await
}

/// 递归拷贝目录 `src` 到 `dst`。`dst` 不存在会被创建。
///
/// 失败时把错误以 String 返回；不会自动回滚已拷贝的部分（调用方负责）。
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("create {} failed: {e}", dst.display()))?;
    let entries =
        fs::read_dir(src).map_err(|e| format!("read_dir {} failed: {e}", src.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if file_type.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else if file_type.is_symlink() {
            // 直接跳过 symlink，避免在 Windows 上无权限链接造成失败。
            continue;
        } else {
            fs::copy(&from, &to)
                .map_err(|e| format!("copy {} -> {} failed: {e}", from.display(), to.display()))?;
        }
    }
    Ok(())
}

/// 校验拷贝结果：递归比较目标目录的文件计数应 ≥ 源（symlink 已跳过故允许相等或大于）。
fn count_files(dir: &Path) -> usize {
    let mut count = 0_usize;
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            count += count_files(&entry.path());
        } else if file_type.is_file() {
            count += 1;
        }
    }
    count
}

/// 把数据根目录从当前位置迁移到 `new_root`：
///
/// 1. 校验 `new_root` 可创建（或已存在且可写）；
/// 2. 停掉本进程启动的 sidecar（释放 SQLite 文件锁）；
/// 3. 把 `<old_effective_root>/agent-gateway` 拷贝到 `<new_root>/agent-gateway`；
/// 4. 校验文件数量 ≥ 源；
/// 5. 写新 `data_root` 到 settings 并删除旧 agent-gateway 目录。
///
/// 注意：迁移完成后**不会自动重启 sidecar**——前端在收到成功响应后，
/// 应主动调用 `start_gateway(port)`，沿用之前的端口即可（参见
/// `use-settings-environment.ts` 的 `saveGatewayUrl` 流程）。
#[tauri::command]
async fn migrate_data_root(
    app: tauri::AppHandle,
    new_root: String,
) -> Result<DesktopSettingsView, String> {
    let new_root_path = PathBuf::from(new_root.trim());
    if new_root_path.as_os_str().is_empty() {
        return Err("new_root 不能为空".to_string());
    }

    let old_root = {
        let state = app.state::<SettingsState>();
        let guard = state.0.lock().map_err(|e| e.to_string())?;
        effective_data_root(&app, &guard)
    };

    let old_root_canonical = fs::canonicalize(&old_root).unwrap_or_else(|_| old_root.clone());
    let new_root_canonical = if new_root_path.exists() {
        fs::canonicalize(&new_root_path).unwrap_or_else(|_| new_root_path.clone())
    } else {
        new_root_path.clone()
    };
    if old_root_canonical == new_root_canonical {
        return Err("新目录与当前数据目录相同".to_string());
    }

    fs::create_dir_all(&new_root_path)
        .map_err(|e| format!("无法创建目标目录 {}: {e}", new_root_path.display()))?;

    let old_gw = old_root.join(GATEWAY_SUBDIR);
    let new_gw = new_root_path.join(GATEWAY_SUBDIR);

    if new_gw.exists() {
        let entries = fs::read_dir(&new_gw)
            .map(|it| it.count())
            .unwrap_or(0);
        if entries > 0 {
            return Err(format!(
                "目标目录已存在且非空: {}。请清空或选择其它目录。",
                new_gw.display()
            ));
        }
    }

    // 先停掉自己启动的 sidecar，释放 sqlite 文件锁，再开始拷贝。
    shutdown_gateway_child(&app);

    if old_gw.exists() {
        let src_count = count_files(&old_gw);
        copy_dir_recursive(&old_gw, &new_gw)?;
        let dst_count = count_files(&new_gw);
        if dst_count < src_count {
            return Err(format!(
                "拷贝校验失败：源 {} 个文件，目标只有 {} 个；旧目录已保留",
                src_count, dst_count
            ));
        }

        // 校验通过 -> 删除旧 agent-gateway 目录。其它顶层文件（如 desktop-settings.json）
        // 不在 agent-gateway 子目录下，不会被波及。
        let _ = fs::remove_dir_all(&old_gw);
    }

    // 写新 data_root 到 settings。
    {
        let state = app.state::<SettingsState>();
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        // 默认根目录 = None；若用户选回默认值则清空 data_root。
        let default_root = default_data_root(&app);
        guard.data_root = if new_root_canonical == default_root {
            None
        } else {
            Some(new_root_path.clone())
        };
        save_settings(&app, &guard);
    }

    let state = app.state::<SettingsState>();
    get_desktop_settings(app.clone(), state).await
}

/// 把主窗口从隐藏/最小化状态恢复并聚焦。
fn restore_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// 切换主窗口可见性：可见且聚焦则隐藏到托盘，否则恢复显示。
///
/// 与微信 / Slack / Discord 等桌面应用的左键点击托盘交互一致。
fn toggle_main_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let visible = window.is_visible().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(false);
    let focused = window.is_focused().unwrap_or(false);
    if visible && !minimized && focused {
        hide_to_tray(app, &window);
    } else {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// 隐藏主窗口到托盘；首次隐藏时推送系统通知。
///
/// 场景 2：若已设置 PIN，隐藏后进入锁定状态——下次用户从托盘唤醒时需输 PIN。
fn hide_to_tray(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    let _ = window.hide();

    let should_notify = {
        if let Some(state) = app.try_state::<SettingsState>() {
            if let Ok(mut guard) = state.0.lock() {
                if !guard.has_seen_tray_hint {
                    guard.has_seen_tray_hint = true;
                    save_settings(app, &guard);
                    true
                } else {
                    false
                }
            } else {
                false
            }
        } else {
            false
        }
    };

    if should_notify {
        let _ = app
            .notification()
            .builder()
            .title("OpenAWork 仍在后台运行")
            .body("窗口已最小化到系统托盘。点击托盘图标或菜单即可重新打开。")
            .show();
    }

    // 有 PIN 才触发锁定——没设时隐藏纯纯是隐藏，不引入多余确认步骤。
    if has_pin(app) {
        set_locked(app, true);
    }
}

/// 创建系统托盘图标和菜单。
///
/// 菜单结构：
/// ```text
/// 显示主窗口
/// ─────────
/// 关闭行为 ▸  ● 每次询问 / ○ 直接最小化 / ○ 直接退出
/// 开机自启   [check]
/// ─────────
/// 打开配置目录
/// 关于 OpenAWork
/// ─────────
/// 退出 OpenAWork
/// ```
///
/// 左键点击图标：toggle 主窗口显示 / 隐藏；右键点击：弹出菜单。
fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let initial_close = read_close_behavior(app);
    let initial_autostart = autostart_enabled(app);

    let show_item = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;

    let cb_ask = CheckMenuItem::with_id(
        app,
        "cb_ask",
        "每次询问",
        true,
        initial_close == CloseBehavior::Ask,
        None::<&str>,
    )?;
    let cb_minimize = CheckMenuItem::with_id(
        app,
        "cb_minimize",
        "直接最小化到托盘",
        true,
        initial_close == CloseBehavior::Minimize,
        None::<&str>,
    )?;
    let cb_exit = CheckMenuItem::with_id(
        app,
        "cb_exit",
        "直接退出",
        true,
        initial_close == CloseBehavior::Exit,
        None::<&str>,
    )?;
    let close_behavior_submenu = Submenu::with_items(
        app,
        "关闭按钮行为",
        true,
        &[&cb_ask, &cb_minimize, &cb_exit],
    )?;

    let autostart_item = CheckMenuItem::with_id(
        app,
        "autostart",
        "开机自启",
        true,
        initial_autostart,
        None::<&str>,
    )?;

    let show_pairing = MenuItem::with_id(
        app,
        "show_pairing_qr",
        "显示配对二维码",
        true,
        None::<&str>,
    )?;
    let check_updates =
        MenuItem::with_id(app, "check_updates", "检查更新", true, None::<&str>)?;
    // C-10 查看日志——打开 gateway 数据目录，log 文件在此目录下。
    let view_logs =
        MenuItem::with_id(app, "view_logs", "查看日志", true, None::<&str>)?;
    let open_config = MenuItem::with_id(app, "open_config", "打开配置目录", true, None::<&str>)?;
    let about = MenuItem::with_id(app, "about", "关于 OpenAWork", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出 OpenAWork", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let sep3 = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(
        app,
        &[
            &show_item,
            &sep1,
            &close_behavior_submenu,
            &autostart_item,
            &sep2,
            &show_pairing,
            &view_logs,
            &open_config,
            &check_updates,
            &about,
            &sep3,
            &quit_item,
        ],
    )?;

    // 把需要动态更新 checked 状态的菜单项存到 managed state。
    app.manage(TrayMenuHandles {
        cb_ask,
        cb_minimize,
        cb_exit,
        autostart: autostart_item,
    });

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("OpenAWork")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => restore_main_window(app),
            "cb_ask" => apply_close_behavior(app, CloseBehavior::Ask),
            "cb_minimize" => apply_close_behavior(app, CloseBehavior::Minimize),
            "cb_exit" => apply_close_behavior(app, CloseBehavior::Exit),
            "autostart" => apply_autostart(app, !autostart_enabled(app)),
            "show_pairing_qr" => {
                // 先 restore 窗口，再 emit 事件。前端 App 监听到后会
                // navigate 到 /settings/desktop?show=pairing，DesktopTabContent 自动展开 QR。
                restore_main_window(app);
                let _ = app.emit("tray:show-pairing-qr", ());
            }
            "check_updates" => trigger_update_check(app),
            "view_logs" => open_gateway_logs_directory(app),
            "open_config" => open_config_directory(app),
            "about" => show_about_dialog(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

/// 用系统默认文件管理器打开桌面端配置目录（`settings.json` 所在）。
fn open_config_directory(app: &tauri::AppHandle) {
    let dir = desktop_home_dir(app);
    let _ = fs::create_dir_all(&dir);
    let _ = app
        .opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>);
}

/// C-10 查看日志：打开 gateway 数据目录（SQLite / log 文件均在此目录）。
/// 若目录不存在则先创建，避免「找不到路径」错误。
fn open_gateway_logs_directory(app: &tauri::AppHandle) {
    let data_dir = {
        match app.try_state::<SettingsState>() {
            Some(state) => match state.0.lock() {
                Ok(guard) => gateway_data_dir(app, &guard),
                Err(_) => return,
            },
            None => return,
        }
    };
    let _ = fs::create_dir_all(&data_dir);
    let _ = app
        .opener()
        .open_path(data_dir.to_string_lossy().to_string(), None::<&str>);
}

/// 手动检查更新。调用 tauri-plugin-updater 拉取 endpoints 中的 latest.json，
/// 根据结果弹对话框提示。有更新版本时询问是否下载安装。
fn trigger_update_check(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let updater = match app.updater() {
            Ok(u) => u,
            Err(err) => {
                app.dialog()
                    .message(format!("检查更新失败：{err}"))
                    .title("OpenAWork 更新")
                    .kind(MessageDialogKind::Error)
                    .show(|_| {});
                return;
            }
        };
        match updater.check().await {
            Ok(Some(update)) => {
                let version = update.version.clone();
                let app_for_dialog = app.clone();
                app.dialog()
                    .message(format!(
                        "发现新版本 {version}\n是否现在下载并安装？"
                    ))
                    .title("OpenAWork 更新")
                    .kind(MessageDialogKind::Info)
                    .buttons(MessageDialogButtons::OkCancelCustom(
                        "立即更新".into(),
                        "稍后".into(),
                    ))
                    .show(move |chose_install| {
                        if !chose_install {
                            return;
                        }
                        let app = app_for_dialog.clone();
                        let update = update;
                        tauri::async_runtime::spawn(async move {
                            // download_and_install 会下载、验证签名、并提示重启。
                            if let Err(err) =
                                update.download_and_install(|_, _| {}, || {}).await
                            {
                                app.dialog()
                                    .message(format!("下载更新失败：{err}"))
                                    .title("OpenAWork 更新")
                                    .kind(MessageDialogKind::Error)
                                    .show(|_| {});
                            }
                        });
                    });
            }
            Ok(None) => {
                let _ = app
                    .notification()
                    .builder()
                    .title("OpenAWork")
                    .body("当前已是最新版本")
                    .show();
            }
            Err(err) => {
                app.dialog()
                    .message(format!("检查更新失败：{err}"))
                    .title("OpenAWork 更新")
                    .kind(MessageDialogKind::Error)
                    .show(|_| {});
            }
        }
    });
}

/// 显示"关于 OpenAWork"对话框（含版本号）。
fn show_about_dialog(app: &tauri::AppHandle) {
    let info = app.package_info();
    let body = format!(
        "{name} v{version}\n\n跨平台 AI Agent 工作台",
        name = info.name,
        version = info.version,
    );
    app.dialog()
        .message(body)
        .title("关于 OpenAWork")
        .kind(MessageDialogKind::Info)
        .show(|_| {});
}

/// 拦截主窗口的关闭按钮：根据持久化设置 `CloseBehavior` 决定行为。
///
/// - `Ask`（默认）：弹对话框让用户选；
/// - `Minimize`：直接 `hide_to_tray`，不弹窗；
/// - `Exit`：直接 `app.exit(0)` → `RunEvent::Exit` 钩子清理 sidecar。
///
/// 用户可以从托盘菜单"关闭按钮行为"子菜单切换偏好；下次起立即生效。
fn handle_window_close_request(window: &tauri::Window, api: &tauri::CloseRequestApi) {
    api.prevent_close();
    let app = window.app_handle().clone();
    let label = window.label().to_string();

    match read_close_behavior(&app) {
        CloseBehavior::Exit => app.exit(0),
        CloseBehavior::Minimize => {
            if let Some(webview_window) = app.get_webview_window(&label) {
                hide_to_tray(&app, &webview_window);
            }
        }
        CloseBehavior::Ask => prompt_close_dialog(app, label),
    }
}

/// 弹出关闭确认对话框；用户选择后执行对应动作。
fn prompt_close_dialog(app: tauri::AppHandle, window_label: String) {
    app.clone()
        .dialog()
        .message(
            "最小化到托盘可保留桌面端与本地网关在后台运行；选择退出会关闭桌面端，\
             并停止本会话启动的 sidecar。\n\n提示：可在托盘菜单的\"关闭按钮行为\"中\
             调整默认动作，下次不再弹此窗。",
        )
        .title("关闭 OpenAWork")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "退出 OpenAWork".into(),
            "最小化到托盘".into(),
        ))
        .show(move |chose_exit| {
            if chose_exit {
                app.exit(0);
            } else if let Some(window) = app.get_webview_window(&window_label) {
                hide_to_tray(&app, &window);
            }
        });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // single-instance 必须最先注册：第二个实例启动时直接回调 → 激活已有窗口然后退出。
        // 防止用户开多个 OpenAWork 桌面端，避免端口冲突 / sidecar 抢占等问题。
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            restore_main_window(app);
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        // C-8 窗口状态记忆：自动持久化窗口大小/位置，下次启动恢复。
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // C-7 全局快捷键：Alt+Shift+O 唤醒主窗口，Alt+Shift+P 显示配对 QR。
        // Windows 用 Alt+Shift 避免与第三方应用 Ctrl+Shift 冲突。
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Released {
                        return;
                    }
                    let matches_wake = shortcut.matches(Modifiers::ALT | Modifiers::SHIFT, Code::KeyO);
                    let matches_pair = shortcut.matches(Modifiers::ALT | Modifiers::SHIFT, Code::KeyP);
                    if matches_wake {
                        restore_main_window(app);
                    }
                    if matches_pair {
                        restore_main_window(app);
                        let _ = app.emit("tray:show-pairing-qr", ());
                    }
                })
                .build()
        )
        .manage(GatewayProcess(Arc::new(Mutex::new(GatewayState {
            child: None,
            port: None,
            generation: 0,
            desktop_auth_token: generate_desktop_auth_token(),
        }))))
        .manage(GatewayHealthState(Arc::new(Mutex::new(GatewayHealth::Stopped))))
        .invoke_handler(tauri::generate_handler![
            start_gateway,
            stop_gateway,
            gateway_status,
            authenticate_desktop_gateway,
            pick_folder,
            open_artifact_path,
            get_desktop_settings,
            update_desktop_settings,
            set_autostart_enabled,
            migrate_data_root,
            set_desktop_pin,
            remove_desktop_pin,
            verify_desktop_pin,
            get_lock_state,
            lock_desktop_now,
        ])
        .setup(|app| {
            // 先加载持久化设置并 manage 全局 state，setup_tray 会读取它来初始化菜单
            // checked 状态。
            let handle = app.handle().clone();
            let persisted = load_settings(&handle);
            let initial_locked = persisted.pin_hash.is_some();
            handle.manage(SettingsState(Arc::new(Mutex::new(persisted))));
            // 启动时有 PIN 则默认锁定（场景 1：每次应用启动）。
            handle.manage(LockState(Arc::new(Mutex::new(LockInner {
                locked: initial_locked,
                ..Default::default()
            }))));
            setup_tray(&handle)?;

            // C-7 注册全局快捷键。
            let _ = handle
                .global_shortcut()
                .register_multiple(["Alt+Shift+O", "Alt+Shift+P"]);
            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                // C-9 系统主题变更 → emit 事件让前端跟随切换 dark/light。
                WindowEvent::ThemeChanged(theme) => {
                    let name = if *theme == tauri::Theme::Dark {
                        "dark"
                    } else {
                        "light"
                    };
                    let _ = window.app_handle().emit("theme-changed", name);
                }
                WindowEvent::CloseRequested { api, .. } => {
                    handle_window_close_request(window, api);
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // 用 RunEvent::Exit 做清理：
    // - 单个窗口关闭被对话框拦截，不会触发清理；
    // - "退出 OpenAWork"（窗口对话框选择 / 托盘菜单 / app.exit）才触发 Exit；
    // - shutdown_gateway_child 只 kill 本桌面端实例自己 spawn 的 child，
    //   复用别的网关时不会误杀，符合"跨会话复用"语义。
    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            shutdown_gateway_child(app_handle);
        }
    });
}
