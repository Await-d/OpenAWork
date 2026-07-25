use serde::Serialize;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State, Url};
use tauri_plugin_updater::UpdaterExt;

use crate::{restore_main_window, shutdown_gateway_child_from_state, GatewayProcess, SettingsState};

const EVT_PROXY_UPDATE_DOWNLOAD: &str = "desktop:proxy-update-download";

const PROXY_UPDATE_ENDPOINTS_PREVIEW: [&str; 1] = [
    "https://github.com/Await-d/OpenAWork/releases/download/desktop-latest-preview/latest.json",
];

const PROXY_UPDATE_ENDPOINTS_STABLE: [&str; 1] = [
    "https://github.com/Await-d/OpenAWork/releases/latest/download/latest.json",
];

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "event", content = "data")]
enum ProxyUpdateDownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started { content_length: Option<u64> },
    #[serde(rename_all = "camelCase")]
    Progress {
        chunk_length: usize,
        downloaded: usize,
        content_length: Option<u64>,
    },
}

fn build_proxy_update_endpoints(proxy_prefix: &str, channel: &str) -> Result<Vec<Url>, String> {
    let endpoints = match channel {
        "stable" => PROXY_UPDATE_ENDPOINTS_STABLE.as_slice(),
        _ => PROXY_UPDATE_ENDPOINTS_PREVIEW.as_slice(),
    };
    endpoints
        .iter()
        .map(|url| Url::parse(&format!("{proxy_prefix}{url}")))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("构建代理更新端点失败：{error}"))
}

fn updater_platform_key() -> Result<&'static str, String> {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        return Ok("windows-x86_64");
    }
    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    {
        return Ok("windows-aarch64");
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        return Ok("darwin-x86_64");
    }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        return Ok("darwin-aarch64");
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        return Ok("linux-x86_64");
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        return Ok("linux-aarch64");
    }
    #[cfg(all(target_os = "linux", target_arch = "arm"))]
    {
        return Ok("linux-armv7");
    }

    #[cfg(not(any(
        all(target_os = "windows", target_arch = "x86_64"),
        all(target_os = "windows", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "aarch64"),
        all(target_os = "linux", target_arch = "arm")
    )))]
    Err(format!(
        "unsupported updater platform: {}-{}",
        std::env::consts::OS,
        std::env::consts::ARCH
    ))
}

#[tauri::command]
pub fn open_update_panel(app: AppHandle, auto_start: Option<bool>) -> Result<(), String> {
    restore_main_window(&app);
    app.emit(
        "tray:check-updates",
        serde_json::json!({
            "autoStart": auto_start.unwrap_or(false),
        }),
    )
    .map_err(|error| format!("打开更新面板失败：{error}"))
}

#[tauri::command]
pub async fn download_and_install_proxy_update(
    app: AppHandle,
    proxy_prefix: String,
    channel: Option<String>,
) -> Result<(), String> {
    let proxy_prefix = proxy_prefix.trim();
    if proxy_prefix.is_empty() {
        return Err("代理前缀不能为空。".to_string());
    }

    let channel = channel.unwrap_or_else(|| "preview".to_string());
    let endpoints = build_proxy_update_endpoints(proxy_prefix, &channel)?;
    let gateway_process_for_updater = app.state::<GatewayProcess>().0.clone();
    let app_handle = app.clone();
    let updater = app
        .updater_builder()
        .on_before_exit(move || {
            shutdown_gateway_child_from_state(&gateway_process_for_updater);
            app_handle.cleanup_before_exit();
        })
        .endpoints(endpoints)
        .map_err(|error| format!("构建代理更新端点失败：{error}"))?
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|error| format!("初始化代理更新器失败：{error}"))?;

    let Some(update) = updater
        .check()
        .await
        .map_err(|error| format!("通过代理检查更新失败：{error}"))?
    else {
        return Err("当前没有可安装的更新。".to_string());
    };

    let progress_app = app.clone();
    let mut first_chunk = true;
    let mut downloaded = 0_usize;

    update
        .download_and_install(
            |chunk_length, content_length| {
                if first_chunk {
                    first_chunk = false;
                    let _ = progress_app.emit(
                        EVT_PROXY_UPDATE_DOWNLOAD,
                        ProxyUpdateDownloadEvent::Started { content_length },
                    );
                }
                downloaded += chunk_length;
                let _ = progress_app.emit(
                    EVT_PROXY_UPDATE_DOWNLOAD,
                    ProxyUpdateDownloadEvent::Progress {
                        chunk_length,
                        downloaded,
                        content_length,
                    },
                );
            },
            || {},
        )
        .await
        .map_err(|error| format!("通过代理下载或安装更新失败：{error}"))?;

    Ok(())
}

#[tauri::command]
pub fn current_updater_platform() -> Result<String, String> {
    Ok(updater_platform_key()?.to_string())
}

#[tauri::command]
pub fn current_update_channel(state: State<'_, SettingsState>) -> Result<String, String> {
    if let Ok(guard) = state.0.lock() {
        if let Some(channel) = &guard.update_channel {
            if channel == "stable" || channel == "preview" {
                return Ok(channel.clone());
            }
        }
    }

    #[cfg(feature = "stable-channel")]
    {
        return Ok("stable".to_string());
    }
    #[cfg(not(feature = "stable-channel"))]
    {
        Ok("preview".to_string())
    }
}
