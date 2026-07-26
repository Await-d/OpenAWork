use super::desktop_control_native_models::ScreenshotResponse;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone)]
pub struct DesktopControlError {
    message: String,
}

impl DesktopControlError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }

    pub fn message(&self) -> &str {
        &self.message
    }
}

impl std::fmt::Display for DesktopControlError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for DesktopControlError {}

pub fn command_exists(program: &str) -> bool {
    let Some(path_value) = std::env::var_os("PATH") else {
        return false;
    };
    std::env::split_paths(&path_value).any(|dir| command_path_exists(dir, program))
}

fn command_path_exists(dir: PathBuf, program: &str) -> bool {
    if dir.join(program).is_file() {
        return true;
    }
    #[cfg(windows)]
    {
        ["exe", "cmd", "bat"]
            .iter()
            .any(|ext| dir.join(format!("{program}.{ext}")).is_file())
    }
    #[cfg(not(windows))]
    {
        false
    }
}

pub fn run_command(program: &str, args: &[String]) -> Result<(), DesktopControlError> {
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|e| DesktopControlError::new(format!("failed to run {program}: {e}")))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    let detail = if stderr.is_empty() { stdout } else { stderr };
    let suffix = if detail.is_empty() {
        String::new()
    } else {
        format!(": {detail}")
    };
    Err(DesktopControlError::new(format!(
        "{program} exited with status {}{suffix}",
        output.status
    )))
}

pub fn temp_png_path(label: &str) -> PathBuf {
    let millis = match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis(),
        Err(_) => 0,
    };
    std::env::temp_dir().join(format!("{label}-{}-{millis}.png", std::process::id()))
}

pub fn read_png_response(
    path: &PathBuf,
    driver: &str,
) -> Result<ScreenshotResponse, DesktopControlError> {
    let bytes = fs::read(path)
        .map_err(|e| DesktopControlError::new(format!("failed to read screenshot: {e}")))?;
    let _ = fs::remove_file(path);
    Ok(ScreenshotResponse {
        success: true,
        media_type: "image/png",
        data: encode_base64(&bytes),
        byte_length: bytes.len(),
        driver: driver.to_owned(),
    })
}

pub fn coordinate_arg(value: f64) -> String {
    format!("{value:.0}")
}

fn encode_base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity(((bytes.len() + 2) / 3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = match chunk.get(1) {
            Some(value) => *value,
            None => 0,
        };
        let b2 = match chunk.get(2) {
            Some(value) => *value,
            None => 0,
        };
        let c0 = b0 >> 2;
        let c1 = ((b0 & 0b0000_0011) << 4) | (b1 >> 4);
        let c2 = ((b1 & 0b0000_1111) << 2) | (b2 >> 6);
        let c3 = b2 & 0b0011_1111;
        output.push(char::from(TABLE[usize::from(c0)]));
        output.push(char::from(TABLE[usize::from(c1)]));
        if chunk.len() > 1 {
            output.push(char::from(TABLE[usize::from(c2)]));
        } else {
            output.push('=');
        }
        if chunk.len() > 2 {
            output.push(char::from(TABLE[usize::from(c3)]));
        } else {
            output.push('=');
        }
    }
    output
}
