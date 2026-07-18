#[test]
fn window_close_request_exits_instead_of_hiding() {
    let lib_rs = include_str!("../src/lib.rs");
    assert!(lib_rs.contains("fn handle_window_close_request("));
    assert!(lib_rs.contains("window.app_handle().exit(0);"));
    assert!(!lib_rs.contains("prompt_close_dialog("));
    assert!(!lib_rs.contains("\"cb_minimize\""));
}
