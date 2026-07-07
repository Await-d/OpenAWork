import { describe, expect, it, vi } from 'vitest';
import type { DesktopControlManager } from '../../tools/desktop-control.js';
import { createDesktopControlManager, runDesktopControlTool } from '../../tools/desktop-control.js';

const SAMPLE_CAPABILITIES = {
  screenshot: { available: true, driver: 'grim' },
  click: { available: true, driver: 'xdotool' },
  typeText: { available: true, driver: 'xdotool' },
  key: { available: true, driver: 'xdotool' },
  hotkey: { available: true, driver: 'xdotool' },
  scroll: { available: true, driver: 'xdotool' },
  wait: { available: true, driver: 'std-thread-sleep' },
} as const;

class FakeDesktopControlManager implements DesktopControlManager {
  readonly status = vi.fn(async () => ({ enabled: true }));
  readonly screenshot = vi.fn(async () => ({ success: true, data: 'base64-image' }));
  readonly click = vi.fn(async () => ({ success: true, x: 12, y: 34 }));
  readonly type = vi.fn(async () => ({ success: true, mode: 'text', textLength: 2 }));
  readonly key = vi.fn(async () => ({ success: true, mode: 'key', key: 'Enter' }));
  readonly hotkey = vi.fn(async () => ({ success: true, mode: 'hotkey', keys: ['Control', 'K'] }));
  readonly scroll = vi.fn(async () => ({ success: true, scrollX: 0, scrollY: -600 }));
  readonly wait = vi.fn(async () => ({ success: true, ms: 250 }));
}

describe('runDesktopControlTool', () => {
  it('status 返回系统桌面控制状态 JSON', async () => {
    const manager = new FakeDesktopControlManager();

    const output = await runDesktopControlTool({ action: 'status' }, manager);

    expect(JSON.parse(output)).toEqual({ enabled: true });
  });

  it('click 会把坐标、按钮和动作传给 manager', async () => {
    const manager = new FakeDesktopControlManager();

    const output = await runDesktopControlTool(
      { action: 'click', x: 12, y: 34, button: 'right', clickAction: 'double_click' },
      manager,
    );

    expect(JSON.parse(output)).toEqual({ success: true, x: 12, y: 34 });
    expect(manager.click).toHaveBeenCalledWith({
      action: 'click',
      x: 12,
      y: 34,
      button: 'right',
      clickAction: 'double_click',
    });
  });

  it('hotkey 会把组合键数组传给 manager', async () => {
    const manager = new FakeDesktopControlManager();

    const output = await runDesktopControlTool(
      { action: 'hotkey', keys: ['Control', 'K'] },
      manager,
    );

    expect(JSON.parse(output)).toEqual({ success: true, mode: 'hotkey', keys: ['Control', 'K'] });
    expect(manager.hotkey).toHaveBeenCalledWith({
      action: 'hotkey',
      keys: ['Control', 'K'],
    });
  });

  it('manager 会把本机桥 reported disabled 转成 disabled runtime', async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => {
      return new Response(JSON.stringify({ enabled: false, reason: 'native bridge unavailable' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const manager = createDesktopControlManager({
      bridgeUrl: 'http://127.0.0.1:39001',
      token: 'token-1',
      fetchImpl,
    });

    const status = await manager.status();

    expect(status).toEqual({ enabled: false, reason: 'native bridge unavailable' });
    await expect(
      manager.click({
        action: 'click',
        x: 1,
        y: 2,
        button: 'left',
        clickAction: 'click',
      }),
    ).rejects.toThrow('desktop control is disabled in this runtime');
  });

  it('manager 会保留本机桥 capabilities 状态', async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => {
      return new Response(JSON.stringify({ enabled: true, capabilities: SAMPLE_CAPABILITIES }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const manager = createDesktopControlManager({
      bridgeUrl: 'http://127.0.0.1:39001',
      token: 'token-1',
      fetchImpl,
    });

    const status = await manager.status();

    expect(status).toEqual({ enabled: true, capabilities: SAMPLE_CAPABILITIES });
  });

  it('manager 会在本机桥启用时转发 click 动作与 token', async () => {
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.endsWith('/status')) {
        return new Response(JSON.stringify({ enabled: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      expect(url).toBe('http://127.0.0.1:39001/actions/click');
      expect(init?.headers).toMatchObject({ authorization: 'Bearer token-1' });
      expect(init?.body).toBe(JSON.stringify({ x: 10, y: 20, button: 'left', action: 'click' }));
      return new Response(JSON.stringify({ success: true, x: 10, y: 20 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const manager = createDesktopControlManager({
      bridgeUrl: 'http://127.0.0.1:39001/',
      token: 'token-1',
      fetchImpl,
    });

    const output = await manager.click({
      action: 'click',
      x: 10,
      y: 20,
      button: 'left',
      clickAction: 'click',
    });

    expect(output).toEqual({ success: true, x: 10, y: 20 });
  });
});
