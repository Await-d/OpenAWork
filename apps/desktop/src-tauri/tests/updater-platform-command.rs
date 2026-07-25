#[test]
fn current_updater_platform_command_is_registered() {
    let updater_commands_rs = include_str!("../src/updater_commands.rs");
    let lib_rs = include_str!("../src/lib.rs");
    assert!(updater_commands_rs.contains("fn updater_platform_key()"));
    assert!(updater_commands_rs.contains("pub fn current_updater_platform()"));
    assert!(lib_rs.contains("current_updater_platform,"));
}

#[test]
fn open_update_panel_command_is_registered() {
    let updater_commands_rs = include_str!("../src/updater_commands.rs");
    let lib_rs = include_str!("../src/lib.rs");
    assert!(updater_commands_rs.contains("pub fn open_update_panel("));
    assert!(updater_commands_rs.contains("\"tray:check-updates\""));
    assert!(updater_commands_rs.contains("\"autoStart\": auto_start.unwrap_or(false)"));
    assert!(lib_rs.contains("open_update_panel,"));
}
