/**
 * 桌面端「应用内弹窗宿主」的前后端契约。
 *
 * 背景：Rust 端只在对应通道被标记就绪时，才把「点 X」「托盘 → 关于」交给应用内
 * 弹窗；否则回落到系统原生 `MessageDialog`。就绪标记靠前端 `invoke` 一个字符串
 * 命令名完成，**类型系统拦不住拼写错误**——历史上就因为把
 * `mark_dialog_host_ready` 写成 `mark_desktop_ui_ready` 而静默失效：命令不存在 →
 * invoke 抛错被 `.catch` 吞掉 → 通道永不就绪 → 用户每次点 X 看到的都是原生提示框，
 * 代码里那个「专门的自定义弹窗」从未出现过。
 *
 * 锁住的不变量（与 desktop/src-tauri/tests/window-close-shutdown.rs 互补：那边查 Rust
 * 侧存在性，这边查两端**名字与通道**对齐）：
 *  - 两端都用 `mark_dialog_host_ready`，且前端必须带 `{ channel }` 参数；
 *  - close 通道的名字在两端都是 `'close'`；
 *  - 关闭请求事件名两端一致（`desktop:close-requested`）；
 *  - 已废弃的错误命令名不得复活。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const dialogSource = readFileSync(join(here, 'CloseConfirmDialog.tsx'), 'utf8');
const aboutSource = readFileSync(join(here, 'AboutDialog.tsx'), 'utf8');
/** `modal/` 上溯五层到 `apps/`，再到 `desktop/src-tauri/src/lib.rs`。 */
const libRs = readFileSync(join(here, '../../../../../desktop/src-tauri/src/lib.rs'), 'utf8');

describe('桌面端应用内弹窗宿主契约', () => {
  it('关闭弹窗必须用 Rust 注册的命令名，并显式带上 close 通道', () => {
    expect(libRs).toContain('fn mark_dialog_host_ready(');
    expect(dialogSource).toContain("tauriInvoke('mark_dialog_host_ready', { channel: 'close' })");
  });

  it('关于弹窗必须用同一命令 + about 通道（两端就绪状态按通道独立）', () => {
    expect(aboutSource).toContain("tauriInvoke('mark_dialog_host_ready', { channel: 'about' })");
    expect(libRs).toContain('enum DialogChannel');
  });

  it('关闭请求事件名两端一致', () => {
    expect(libRs).toContain('const EVT_CLOSE_REQUESTED: &str = "desktop:close-requested"');
    expect(dialogSource).toContain("const EVT_CLOSE_REQUESTED = 'desktop:close-requested'");
  });

  it('不得复活已废弃的 mark_desktop_ui_ready（该名字不存在于 Rust 侧）', () => {
    expect(libRs).not.toContain('mark_desktop_ui_ready');
    expect(dialogSource).not.toContain('mark_desktop_ui_ready');
    expect(aboutSource).not.toContain('mark_desktop_ui_ready');
  });
});
