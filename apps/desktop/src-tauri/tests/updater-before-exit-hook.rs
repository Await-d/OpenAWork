#[test]
fn updater_before_exit_hook_stops_gateway_child() {
    let lib_rs = include_str!("../src/lib.rs");
    assert!(lib_rs.contains("tauri_plugin_updater::Builder::new()"));
    assert!(lib_rs.contains(".on_before_exit("));
    assert!(lib_rs.contains("shutdown_gateway_child_from_state(&gateway_process_for_updater);"));
}
