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
    // Ask 分支必须走应用内自定义弹窗（前端监听事件 + 回执命令）
    assert!(lib_rs.contains("desktop:close-requested"));
    assert!(lib_rs.contains("fn resolve_close_request("));
    assert!(lib_rs.contains("fn mark_dialog_host_ready("));
    // 就绪状态必须按通道分开记录，否则其中一个弹窗挂载就会误判另一个通道就绪
    assert!(lib_rs.contains("enum DialogChannel"));
    assert!(lib_rs.contains("fn is_dialog_host_ready("));
    // 前端未就绪时仍需保留系统原生对话框兜底
    assert!(lib_rs.contains("fn show_native_close_dialog("));
    assert!(lib_rs.contains("fn show_native_about_dialog("));
}

#[test]
fn tray_about_and_check_updates_use_in_app_surfaces() {
    let lib_rs = include_str!("../src/lib.rs");
    // 「关于」优先走应用内弹窗，未就绪才回落原生对话框
    assert!(lib_rs.contains("tray:about"));
    assert!(lib_rs.contains("fn request_about_dialog("));
    assert!(lib_rs.contains("request_about_dialog(app)"));
    // 「检查更新」携带 autoStart 让前端跳到关于页后自动检查
    assert!(lib_rs.contains("\"tray:check-updates\""));
    assert!(lib_rs.contains("\"autoStart\": true"));
}
