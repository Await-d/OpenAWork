import { describe, expect, it, vi } from 'vitest';
import {
  type DesktopAutomationManager,
  runDesktopAutomationTool,
} from '../../tools/desktop-automation.js';

class FakeDesktopAutomationManager implements DesktopAutomationManager {
  readonly status = vi.fn(async () => ({ enabled: true, started: true }));
  readonly start = vi.fn(async (_startUrl?: string) => {});
  readonly goto = vi.fn(async (_url: string) => {});
  readonly back = vi.fn(async () => {});
  readonly forward = vi.fn(async () => {});
  readonly reload = vi.fn(async () => {});
  readonly click = vi.fn(async (_selector: string) => {});
  readonly type = vi.fn(async (_selector: string, _text: string) => {});
  readonly press = vi.fn(async (_selector: string, _key: string) => {});
  readonly scroll = vi.fn(async (_direction: 'up' | 'down', _amount?: number) => {});
  readonly wait = vi.fn(async (_input: { readonly ms?: number; readonly selector?: string }) => {});
  readonly content = vi.fn(async () => '<html><body>ready</body></html>');
  readonly snapshot = vi.fn(async () => ({
    currentPageId: 'page-1',
    openPages: ['page-1'],
    title: 'Ready',
    url: 'https://example.test/',
  }));
  readonly screenshot = vi.fn(async () => 'base64-image');
}

describe('runDesktopAutomationTool', () => {
  it('执行滚动、等待、按键和内容读取动作', async () => {
    const manager = new FakeDesktopAutomationManager();

    await expect(
      runDesktopAutomationTool({ action: 'scroll', direction: 'down', amount: 480 }, manager),
    ).resolves.toBe(JSON.stringify({ ok: true }));
    await expect(
      runDesktopAutomationTool({ action: 'wait', selector: '#ready', ms: 1000 }, manager),
    ).resolves.toBe(JSON.stringify({ ok: true }));
    await expect(
      runDesktopAutomationTool({ action: 'press', selector: '#search', key: 'Enter' }, manager),
    ).resolves.toBe(JSON.stringify({ ok: true }));
    await expect(runDesktopAutomationTool({ action: 'content' }, manager)).resolves.toBe(
      JSON.stringify({ content: '<html><body>ready</body></html>' }),
    );

    expect(manager.scroll).toHaveBeenCalledWith('down', 480);
    expect(manager.wait).toHaveBeenCalledWith({ selector: '#ready', ms: 1000 });
    expect(manager.press).toHaveBeenCalledWith('#search', 'Enter');
    expect(manager.content).toHaveBeenCalledOnce();
  });

  it('读取浏览器快照并保留页面元数据', async () => {
    const manager = new FakeDesktopAutomationManager();

    await expect(runDesktopAutomationTool({ action: 'snapshot' }, manager)).resolves.toBe(
      JSON.stringify({
        snapshot: {
          currentPageId: 'page-1',
          openPages: ['page-1'],
          title: 'Ready',
          url: 'https://example.test/',
        },
      }),
    );
  });
});
