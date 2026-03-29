use std::sync::Mutex;
use tauri::path::BaseDirectory;
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandChild;

struct GatewayProcess(Mutex<Option<CommandChild>>);

#[tauri::command]
async fn start_gateway(
    port: u16,
    app: tauri::AppHandle,
    state: State<'_, GatewayProcess>,
) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Ok(());
    }

    let entry = app
        .path()
        .resolve("sidecars/agent-gateway/dist/index.js", BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;

    let cwd = entry
        .parent()
        .ok_or("Cannot resolve gateway parent dir".to_string())?
        .parent()
        .ok_or("Cannot resolve gateway root dir".to_string())?
        .to_path_buf();

    let (_rx, child) = app
        .shell()
        .sidecar("node")
        .map_err(|e| e.to_string())?
        .current_dir(cwd)
        .arg(entry)
        .env("GATEWAY_PORT", port.to_string())
        .env("GATEWAY_HOST", "127.0.0.1")
        .env("DESKTOP_AUTOMATION", "1")
        .spawn()
        .map_err(|e| e.to_string())?;

    *guard = Some(child);
    Ok(())
}

#[tauri::command]
async fn stop_gateway(state: State<'_, GatewayProcess>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(child) = guard.take() {
        child.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn gateway_status(state: State<'_, GatewayProcess>) -> Result<bool, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    Ok(guard.is_some())
}

#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let folder = app
        .dialog()
        .file()
        .blocking_pick_folder();
    Ok(folder.map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
async fn open_artifact_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.shell()
        .open(path, None::<String>)
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(GatewayProcess(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            start_gateway,
            stop_gateway,
            gateway_status,
            pick_folder,
            open_artifact_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
