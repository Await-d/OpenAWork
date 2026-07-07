use crate::desktop_control_native::{
    DesktopControlAction, DesktopControlActionResponse, DesktopControlCapabilities,
    DesktopControlCapability, DesktopControlError, DesktopControlStatus,
};

const UNSUPPORTED_REASON: &str = "desktop control is not supported on this operating system";

pub fn status() -> DesktopControlStatus {
    let unsupported = DesktopControlCapability::unavailable(UNSUPPORTED_REASON);
    DesktopControlStatus {
        enabled: false,
        reason: Some(UNSUPPORTED_REASON.to_owned()),
        capabilities: DesktopControlCapabilities {
            screenshot: unsupported.clone(),
            click: unsupported.clone(),
            type_text: unsupported.clone(),
            key: unsupported.clone(),
            hotkey: unsupported.clone(),
            scroll: unsupported.clone(),
            wait: DesktopControlCapability::available("std-thread-sleep"),
        },
    }
}

pub fn execute_action(
    action: DesktopControlAction,
) -> Result<DesktopControlActionResponse, DesktopControlError> {
    match action {
        DesktopControlAction::Wait(request) => {
            std::thread::sleep(std::time::Duration::from_millis(request.ms.min(10_000)));
            Ok(DesktopControlActionResponse::Wait(
                crate::desktop_control_native::WaitResponse {
                    success: true,
                    ms: request.ms.min(10_000),
                },
            ))
        }
        DesktopControlAction::Screenshot(_)
        | DesktopControlAction::Click(_)
        | DesktopControlAction::TypeText(_)
        | DesktopControlAction::Key(_)
        | DesktopControlAction::Hotkey(_)
        | DesktopControlAction::Scroll(_) => Err(DesktopControlError::new(UNSUPPORTED_REASON)),
    }
}
