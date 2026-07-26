use crate::desktop_control_native::{
    execute_action, status, ClickRequest, DesktopControlAction, HotkeyRequest, KeyRequest,
    ScreenshotRequest, ScrollRequest, TypeTextRequest, WaitRequest,
};
use serde::{de::DeserializeOwned, Serialize};
use std::sync::{Arc, Mutex};
use tokio::io::AsyncWriteExt;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

#[path = "desktop_control_http.rs"]
mod desktop_control_http;
use self::desktop_control_http::read_http_request;

#[derive(Default)]
pub struct DesktopControlBridgeProcess(Arc<Mutex<Option<DesktopControlBridgeHandle>>>);

struct DesktopControlBridgeHandle {
    port: u16,
    shutdown: Option<oneshot::Sender<()>>,
}

#[derive(Serialize)]
struct ErrorResponse<'a> {
    error: &'a str,
}

impl DesktopControlBridgeProcess {
    pub async fn ensure_started(&self, token: String) -> Result<String, String> {
        if let Some(port) = self.current_port()? {
            return Ok(local_bridge_url(port));
        }

        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .map_err(|e| format!("bind desktop control bridge failed: {e}"))?;
        let port = listener
            .local_addr()
            .map_err(|e| format!("read desktop control bridge address failed: {e}"))?
            .port();
        let (shutdown, shutdown_rx) = oneshot::channel();

        {
            let mut guard = self
                .0
                .lock()
                .map_err(|e| format!("desktop control bridge lock poisoned: {e}"))?;
            *guard = Some(DesktopControlBridgeHandle {
                port,
                shutdown: Some(shutdown),
            });
        }

        tauri::async_runtime::spawn(async move {
            run_bridge(listener, token, shutdown_rx).await;
        });

        Ok(local_bridge_url(port))
    }

    fn current_port(&self) -> Result<Option<u16>, String> {
        let guard = self
            .0
            .lock()
            .map_err(|e| format!("desktop control bridge lock poisoned: {e}"))?;
        Ok(guard.as_ref().map(|handle| handle.port))
    }
}

impl Drop for DesktopControlBridgeProcess {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(mut handle) = guard.take() {
                if let Some(shutdown) = handle.shutdown.take() {
                    let _ = shutdown.send(());
                }
            }
        }
    }
}

fn local_bridge_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

async fn run_bridge(listener: TcpListener, token: String, mut shutdown: oneshot::Receiver<()>) {
    loop {
        tokio::select! {
            accept_result = listener.accept() => {
                let Ok((stream, _addr)) = accept_result else {
                    continue;
                };
                let token_for_connection = token.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = handle_connection(stream, token_for_connection).await;
                });
            }
            _ = &mut shutdown => {
                break;
            }
        }
    }
}

async fn handle_connection(mut stream: TcpStream, token: String) -> Result<(), std::io::Error> {
    let request = match read_http_request(&mut stream).await {
        Ok(request) => request,
        Err(error) => {
            let response = ErrorResponse {
                error: error.as_str(),
            };
            return write_json(&mut stream, 400, &response).await;
        }
    };
    if !is_authorized(&request.headers, &token) {
        return write_json(&mut stream, 403, &ErrorResponse { error: "forbidden" }).await;
    }

    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/status") => write_json(&mut stream, 200, &status()).await,
        ("POST", route) if route.starts_with("/actions/") => {
            handle_action(&mut stream, route, &request.body).await
        }
        _ => write_json(&mut stream, 404, &ErrorResponse { error: "not found" }).await,
    }
}

async fn handle_action(
    stream: &mut TcpStream,
    route: &str,
    body: &[u8],
) -> Result<(), std::io::Error> {
    let action_name = route.trim_start_matches("/actions/");
    let action = match parse_action(action_name, body) {
        Ok(action) => action,
        Err(error) => {
            let response = ErrorResponse {
                error: error.as_str(),
            };
            return write_json(stream, 400, &response).await;
        }
    };
    match execute_action(action).await {
        Ok(result) => write_json(stream, 200, &result).await,
        Err(error) => {
            let response = ErrorResponse {
                error: error.message(),
            };
            write_json(stream, 503, &response).await
        }
    }
}

fn parse_action(action_name: &str, body: &[u8]) -> Result<DesktopControlAction, String> {
    match action_name {
        "screenshot" => parse_json::<ScreenshotRequest>(body).map(DesktopControlAction::Screenshot),
        "click" => parse_json::<ClickRequest>(body).map(DesktopControlAction::Click),
        "type" => parse_json::<TypeTextRequest>(body).map(DesktopControlAction::TypeText),
        "key" => parse_json::<KeyRequest>(body).map(DesktopControlAction::Key),
        "hotkey" => parse_json::<HotkeyRequest>(body).map(DesktopControlAction::Hotkey),
        "scroll" => parse_json::<ScrollRequest>(body).map(DesktopControlAction::Scroll),
        "wait" => parse_json::<WaitRequest>(body).map(DesktopControlAction::Wait),
        _ => Err(format!("unsupported desktop control action: {action_name}")),
    }
}

fn parse_json<T: DeserializeOwned>(body: &[u8]) -> Result<T, String> {
    let source: &[u8] = if body.is_empty() { b"{}" } else { body };
    serde_json::from_slice::<T>(source).map_err(|e| format!("invalid JSON request body: {e}"))
}

fn is_authorized(headers: &str, token: &str) -> bool {
    let expected = format!("Bearer {token}");
    headers.lines().any(|line| {
        let Some((name, value)) = line.split_once(':') else {
            return false;
        };
        name.eq_ignore_ascii_case("authorization") && value.trim() == expected
    })
}

async fn write_json<T: Serialize>(
    stream: &mut TcpStream,
    status: u16,
    body: &T,
) -> Result<(), std::io::Error> {
    let bytes = match serde_json::to_vec(body) {
        Ok(bytes) => bytes,
        Err(_) => b"{\"error\":\"json encode failed\"}".to_vec(),
    };
    let reason = reason_phrase(status);
    let header = format!(
        "HTTP/1.1 {status} {reason}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
        bytes.len()
    );
    stream.write_all(header.as_bytes()).await?;
    stream.write_all(&bytes).await
}

fn reason_phrase(status: u16) -> &'static str {
    match status {
        200 => "OK",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        503 => "Service Unavailable",
        _ => "Unknown",
    }
}
