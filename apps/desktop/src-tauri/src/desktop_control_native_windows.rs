use crate::desktop_control_native::{
    command_exists, coordinate_arg, read_png_response, run_command, temp_png_path, ClickAction,
    ClickRequest, ClickResponse, DesktopControlAction, DesktopControlActionResponse,
    DesktopControlCapabilities, DesktopControlCapability, DesktopControlError,
    DesktopControlStatus, DragRequest, DragResponse, LongPressRequest, LongPressResponse,
    MouseButton, MouseMoveRequest, MouseMoveResponse, ScreenshotRequest, ScrollRequest,
    ScrollResponse, WaitRequest, WaitResponse,
};
use std::thread;
use std::time::Duration;

#[path = "desktop_control_native_windows_input.rs"]
mod input;

const POWERSHELL_REASON: &str = "PowerShell is required for native Windows desktop control";
const MAX_GESTURE_MS: u64 = 10_000;
const DRAG_STEPS: u32 = 8;

pub fn status() -> DesktopControlStatus {
    let driver = powershell_program();
    let capability = match driver {
        Some(name) => DesktopControlCapability::available(name),
        None => DesktopControlCapability::unavailable(POWERSHELL_REASON),
    };
    DesktopControlStatus {
        enabled: true,
        reason: None,
        capabilities: DesktopControlCapabilities {
            screenshot: capability.clone(),
            click: capability.clone(),
            type_text: capability.clone(),
            key: capability.clone(),
            hotkey: capability.clone(),
            scroll: capability.clone(),
            drag: capability.clone(),
            mouse_move: capability.clone(),
            long_press: capability,
            wait: DesktopControlCapability::available("std-thread-sleep"),
        },
    }
}

pub fn execute_action(
    action: DesktopControlAction,
) -> Result<DesktopControlActionResponse, DesktopControlError> {
    match action {
        DesktopControlAction::Screenshot(request) => {
            capture_screenshot(request).map(DesktopControlActionResponse::Screenshot)
        }
        DesktopControlAction::Click(request) => {
            click(request).map(DesktopControlActionResponse::Click)
        }
        DesktopControlAction::TypeText(request) => {
            input::type_text(request).map(DesktopControlActionResponse::TypeText)
        }
        DesktopControlAction::Key(request) => {
            input::key(request).map(DesktopControlActionResponse::Key)
        }
        DesktopControlAction::Hotkey(request) => {
            input::hotkey(request).map(DesktopControlActionResponse::Hotkey)
        }
        DesktopControlAction::Scroll(request) => {
            scroll(request).map(DesktopControlActionResponse::Scroll)
        }
        DesktopControlAction::Drag(request) => {
            drag(request).map(DesktopControlActionResponse::Drag)
        }
        DesktopControlAction::MouseMove(request) => {
            mouse_move(request).map(DesktopControlActionResponse::MouseMove)
        }
        DesktopControlAction::LongPress(request) => {
            long_press(request).map(DesktopControlActionResponse::LongPress)
        }
        DesktopControlAction::Wait(request) => {
            Ok(DesktopControlActionResponse::Wait(wait(request)))
        }
    }
}

fn capture_screenshot(
    request: ScreenshotRequest,
) -> Result<crate::desktop_control_native::ScreenshotResponse, DesktopControlError> {
    if let Some(delay_ms) = request.delay_ms {
        thread::sleep(Duration::from_millis(delay_ms.min(5_000)));
    }
    let path = temp_png_path("openawork-desktop-control");
    let file = path.to_string_lossy().to_string();
    let script = format!(
        "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; \
         $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; \
         $bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; \
         $g=[System.Drawing.Graphics]::FromImage($bmp); \
         $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); \
         $bmp.Save({},[System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()",
        ps_string(&file)
    );
    run_powershell(script)?;
    read_png_response(&path, &powershell_driver())
}

fn click(request: ClickRequest) -> Result<ClickResponse, DesktopControlError> {
    let flags = mouse_event_flags(request.click_action, request.button);
    let script = format!(
        "{} [MouseBridge]::SetCursorPos({},{}); {}",
        mouse_bridge_type(),
        coordinate_arg(request.x),
        coordinate_arg(request.y),
        flags
    );
    run_powershell(script)?;
    Ok(ClickResponse {
        success: true,
        x: request.x,
        y: request.y,
        button: request.button,
        action: request.click_action,
        driver: powershell_driver(),
    })
}

fn scroll(request: ScrollRequest) -> Result<ScrollResponse, DesktopControlError> {
    let mut script = mouse_bridge_type();
    if let (Some(x), Some(y)) = (request.x, request.y) {
        script.push_str(&format!(
            " [MouseBridge]::SetCursorPos({},{});",
            coordinate_arg(x),
            coordinate_arg(y)
        ));
    } else if request.x.is_some() || request.y.is_some() {
        return Err(DesktopControlError::new(
            "scroll anchor requires both x and y coordinates",
        ));
    }
    script.push_str(&format!(
        " [MouseBridge]::mouse_event(0x0800,0,0,{},[UIntPtr]::Zero); \
         [MouseBridge]::mouse_event(0x1000,0,0,{},[UIntPtr]::Zero);",
        coordinate_arg(-request.scroll_y),
        coordinate_arg(request.scroll_x)
    ));
    run_powershell(script)?;
    Ok(ScrollResponse {
        success: true,
        x: request.x,
        y: request.y,
        scroll_x: request.scroll_x,
        scroll_y: request.scroll_y,
        driver: powershell_driver(),
    })
}

fn wait(request: WaitRequest) -> WaitResponse {
    let ms = request.ms.min(10_000);
    thread::sleep(Duration::from_millis(ms));
    WaitResponse { success: true, ms }
}

fn mouse_move(request: MouseMoveRequest) -> Result<MouseMoveResponse, DesktopControlError> {
    let script = format!(
        "{} [MouseBridge]::SetCursorPos({},{});",
        mouse_bridge_type(),
        coordinate_arg(request.x),
        coordinate_arg(request.y)
    );
    run_powershell(script)?;
    Ok(MouseMoveResponse {
        success: true,
        x: request.x,
        y: request.y,
        driver: powershell_driver(),
    })
}

fn drag(request: DragRequest) -> Result<DragResponse, DesktopControlError> {
    let mut script = mouse_bridge_type();
    script.push_str(&format!(
        " [MouseBridge]::SetCursorPos({},{});",
        coordinate_arg(request.from_x),
        coordinate_arg(request.from_y)
    ));
    script.push_str(&format!(
        " {}",
        mouse_event_flags(ClickAction::Down, request.button)
    ));
    let step_delay = gesture_step_delay(request.ms.min(MAX_GESTURE_MS), DRAG_STEPS);
    for index in 1..=DRAG_STEPS {
        let ratio = f64::from(index) / f64::from(DRAG_STEPS);
        let x = request.from_x + (request.to_x - request.from_x) * ratio;
        let y = request.from_y + (request.to_y - request.from_y) * ratio;
        script.push_str(&format!(
            " [MouseBridge]::SetCursorPos({},{});",
            coordinate_arg(x),
            coordinate_arg(y)
        ));
        if step_delay > 0 {
            script.push_str(&format!(" Start-Sleep -Milliseconds {step_delay};"));
        }
    }
    script.push_str(&format!(
        " {}",
        mouse_event_flags(ClickAction::Up, request.button)
    ));
    run_powershell(script)?;
    Ok(DragResponse {
        success: true,
        from_x: request.from_x,
        from_y: request.from_y,
        to_x: request.to_x,
        to_y: request.to_y,
        button: request.button,
        driver: powershell_driver(),
    })
}

fn long_press(request: LongPressRequest) -> Result<LongPressResponse, DesktopControlError> {
    let ms = request.ms.min(MAX_GESTURE_MS);
    let mut script = mouse_bridge_type();
    script.push_str(&format!(
        " [MouseBridge]::SetCursorPos({},{});",
        coordinate_arg(request.x),
        coordinate_arg(request.y)
    ));
    script.push_str(&format!(
        " {}",
        mouse_event_flags(ClickAction::Down, request.button)
    ));
    if ms > 0 {
        script.push_str(&format!(" Start-Sleep -Milliseconds {ms};"));
    }
    script.push_str(&format!(
        " {}",
        mouse_event_flags(ClickAction::Up, request.button)
    ));
    run_powershell(script)?;
    Ok(LongPressResponse {
        success: true,
        x: request.x,
        y: request.y,
        button: request.button,
        ms,
        driver: powershell_driver(),
    })
}

fn gesture_step_delay(ms: u64, steps: u32) -> u64 {
    if steps == 0 {
        return 0;
    }
    ms / u64::from(steps)
}

fn powershell_program() -> Option<&'static str> {
    ["pwsh", "powershell.exe", "powershell"]
        .into_iter()
        .find(|program| command_exists(program))
}

pub(super) fn powershell_driver() -> String {
    match powershell_program() {
        Some(program) => program.to_owned(),
        None => "powershell".to_owned(),
    }
}

pub(super) fn run_powershell(script: String) -> Result<(), DesktopControlError> {
    let Some(program) = powershell_program() else {
        return Err(DesktopControlError::new(POWERSHELL_REASON));
    };
    run_command(
        program,
        &[
            "-NoProfile".to_owned(),
            "-NonInteractive".to_owned(),
            "-ExecutionPolicy".to_owned(),
            "Bypass".to_owned(),
            "-Command".to_owned(),
            script,
        ],
    )
}

fn mouse_bridge_type() -> String {
    "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; \
     public static class MouseBridge { \
     [DllImport(\"user32.dll\")] public static extern bool SetCursorPos(int X,int Y); \
     [DllImport(\"user32.dll\")] public static extern void mouse_event(uint f,uint x,uint y,int d,UIntPtr e); }';"
        .to_owned()
}

fn mouse_event_flags(action: ClickAction, button: MouseButton) -> String {
    let (down, up) = match button {
        MouseButton::Left => ("0x0002", "0x0004"),
        MouseButton::Right => ("0x0008", "0x0010"),
        MouseButton::Middle => ("0x0020", "0x0040"),
    };
    let call = |flag: &str| format!("[MouseBridge]::mouse_event({flag},0,0,0,[UIntPtr]::Zero);");
    match action {
        ClickAction::Click => format!("{} {}", call(down), call(up)),
        ClickAction::DoubleClick => {
            format!("{} {} {} {}", call(down), call(up), call(down), call(up))
        }
        ClickAction::Down => call(down),
        ClickAction::Up => call(up),
    }
}

pub(super) fn ps_string(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}
