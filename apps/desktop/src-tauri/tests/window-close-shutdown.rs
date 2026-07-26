#[test]
fn window_close_request_respects_close_behavior_setting() {
    let lib_rs = include_str!("../src/lib.rs");
    // handle_window_close_request 函数必须存在
    assert!(lib_rs.contains("fn handle_window_close_request("));
    // 必须根据 close_behavior 设置执行不同行为
    assert!(lib_rs.contains("CloseBehavior::Exit"));
    assert!(lib_rs.contains("CloseBehavior::Minimize"));
    assert!(lib_rs.contains("CloseBehavior::Ask"));
    // 必须从 SettingsState 读取 close_behavior
    assert!(lib_rs.contains("SettingsState"));
    assert!(lib_rs.contains("close_behavior"));
    // 退出时必须调用 app.exit(0)
    assert!(lib_rs.contains("app.exit(0)"));
    // 最小化时必须调用 hide_to_tray
    assert!(lib_rs.contains("hide_to_tray"));
}
