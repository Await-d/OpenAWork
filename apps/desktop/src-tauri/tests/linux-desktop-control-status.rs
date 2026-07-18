#[test]
fn linux_desktop_control_status_reports_session_specific_reasoning() {
    let linux_rs = include_str!("../src/desktop_control_native_linux.rs");
    let linux_input_rs = include_str!("../src/desktop_control_native_linux_input.rs");

    assert!(linux_rs.contains("enum LinuxSessionKind"));
    assert!(linux_rs.contains("linux_session_kind_from_env("));
    assert!(linux_rs.contains("Wayland session detected; input control requires xdotool and an X11 session"));
    assert!(linux_rs.contains("desktop control bridge is running with limited native drivers"));
    assert!(linux_input_rs.contains("super::input_unavailable_reason"));
}
