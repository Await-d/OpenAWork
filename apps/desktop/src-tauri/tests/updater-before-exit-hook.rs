#[test]
fn proxy_update_path_rebinds_before_exit_hook_to_stop_gateway_child() {
    let updater_commands_rs = include_str!("../src/updater_commands.rs");
    let proxy_update_section = updater_commands_rs
        .split("async fn download_and_install_proxy_update")
        .nth(1)
        .expect("proxy update command should exist");
    assert!(proxy_update_section.contains(".updater_builder()"));
    assert!(proxy_update_section.contains(".on_before_exit("));
    assert!(proxy_update_section.contains("shutdown_gateway_child_from_state(&gateway_process_for_updater);"));
    assert!(proxy_update_section.contains("app_handle.cleanup_before_exit();"));
}

#[test]
fn updater_plugin_builder_stays_on_default_build_path() {
    let lib_rs = include_str!("../src/lib.rs");
    let run_section = lib_rs
        .split("pub fn run()")
        .nth(1)
        .expect("run function should exist");
    assert!(run_section.contains("let updater_plugin = tauri_plugin_updater::Builder::new().build();"));
    assert!(!run_section.contains("tauri_plugin_updater::Builder::new()\n        .on_before_exit("));
}
