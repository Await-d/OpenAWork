#[test]
fn current_updater_platform_command_is_registered() {
    let lib_rs = include_str!("../src/lib.rs");
    assert!(lib_rs.contains("fn updater_platform_key()"));
    assert!(lib_rs.contains("fn current_updater_platform()"));
    assert!(lib_rs.contains("current_updater_platform,"));
}
