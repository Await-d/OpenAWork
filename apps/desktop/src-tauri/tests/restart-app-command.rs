#[test]
fn restart_app_command_is_registered() {
    let lib_rs = include_str!("../src/lib.rs");
    assert!(lib_rs.contains("async fn restart_app("));
    assert!(lib_rs.contains("restart_app,"));
    assert!(lib_rs.contains("stop_gateway(app.clone(), state).await"));
    assert!(lib_rs.contains("Command::new(current_exe)"));
    assert!(lib_rs.contains("app.exit(0);"));
}
