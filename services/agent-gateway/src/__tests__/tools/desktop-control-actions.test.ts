import { describe, expect, it, vi } from 'vitest';
import {
  createDesktopControlManager,
  desktopControlToolDefinition,
  runDesktopControlTool,
} from '../../tools/desktop-control.js';
import { desktopControlBridgeStatusSchema } from '../../tools/desktop-control-status.js';

const inputSchema = desktopControlToolDefinition.inputSchema;

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function createBridgeFetch(
  onAction: (url: string, body: Record<string, unknown>) => void,
): (input: string | URL, init?: RequestInit) => Promise<Response> {
  return async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.endsWith('/status')) {
      return jsonResponse({ enabled: true });
    }
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    onAction(url, body);
    return jsonResponse({ success: true });
  };
}

describe('desktop_control 新动作 schema', () => {
  it('drag 合法输入补齐默认 button / ms', () => {
    const parsed = inputSchema.safeParse({
      action: 'drag',
      fromX: 1,
      fromY: 2,
      toX: 30,
      toY: 40,
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toMatchObject({
      action: 'drag',
      fromX: 1,
      fromY: 2,
      toX: 30,
      toY: 40,
      button: 'left',
      ms: 300,
    });
  });

  it('drag 缺少终点坐标时报错', () => {
    const parsed = inputSchema.safeParse({ action: 'drag', fromX: 1, fromY: 2, toX: 30 });

    expect(parsed.success).toBe(false);
  });

  it('drag ms 超出 0..5000 时报错', () => {
    const parsed = inputSchema.safeParse({
      action: 'drag',
      fromX: 1,
      fromY: 2,
      toX: 30,
      toY: 40,
      ms: 6000,
    });

    expect(parsed.success).toBe(false);
  });

  it('mouse_move 支持 x/y 与 box 两种输入', () => {
    expect(inputSchema.safeParse({ action: 'mouse_move', x: 5, y: 6 }).success).toBe(true);
    expect(inputSchema.safeParse({ action: 'mouse_move', box: [0, 0, 10, 10] }).success).toBe(true);
  });

  it('mouse_move 既无 box 也无 x/y 时报错', () => {
    const parsed = inputSchema.safeParse({ action: 'mouse_move' });

    expect(parsed.success).toBe(false);
    expect(parsed.success ? '' : parsed.error.issues[0]?.message).toContain('必须提供 box');
  });

  it('box 与 x/y 同时出现时报错', () => {
    const parsed = inputSchema.safeParse({
      action: 'mouse_move',
      x: 5,
      y: 6,
      box: [0, 0, 10, 10],
    });

    expect(parsed.success).toBe(false);
    expect(parsed.success ? '' : parsed.error.issues[0]?.message).toContain('只能二选一');
  });

  it('box 形状非法（x1 >= x2）时报错', () => {
    const parsed = inputSchema.safeParse({ action: 'click', box: [30, 0, 10, 40] });

    expect(parsed.success).toBe(false);
    expect(parsed.success ? '' : parsed.error.issues[0]?.message).toContain('x1 < x2');
  });

  it('box 元素个数不是 4 时报错', () => {
    expect(inputSchema.safeParse({ action: 'click', box: [1, 2, 3] }).success).toBe(false);
    expect(inputSchema.safeParse({ action: 'click', box: [1, 2, 3, 4, 5] }).success).toBe(false);
  });

  it('click 保留 x/y 输入并提供默认参数', () => {
    const parsed = inputSchema.safeParse({ action: 'click', x: 12, y: 34 });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toMatchObject({
      action: 'click',
      x: 12,
      y: 34,
      button: 'left',
      clickAction: 'click',
    });
  });

  it('long_press 默认 ms 为 800，低于 100 报错', () => {
    const parsed = inputSchema.safeParse({ action: 'long_press', x: 1, y: 2 });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toMatchObject({ action: 'long_press', ms: 800 });
    expect(inputSchema.safeParse({ action: 'long_press', x: 1, y: 2, ms: 50 }).success).toBe(false);
  });
});

describe('desktop_control box 中心换算', () => {
  it('click 使用 box 中心调用 manager', async () => {
    const bridgeFetch = createBridgeFetch((url, body) => {
      expect(url).toBe('http://127.0.0.1:39001/actions/click');
      expect(body).toEqual({ x: 20, y: 30, button: 'left', action: 'click' });
    });
    const manager = createDesktopControlManager({
      bridgeUrl: 'http://127.0.0.1:39001',
      token: 'token-1',
      fetchImpl: bridgeFetch,
    });

    const parsed = inputSchema.parse({ action: 'click', box: [10, 20, 30, 40] });
    const output = await runDesktopControlTool(parsed, manager);

    expect(JSON.parse(output)).toEqual({ success: true });
  });

  it('mouse_move 把 box 中心发给桥的 /actions/mouse_move', async () => {
    const bridgeFetch = createBridgeFetch((url, body) => {
      expect(url).toBe('http://127.0.0.1:39001/actions/mouse_move');
      expect(body).toEqual({ x: 50, y: 60 });
    });
    const manager = createDesktopControlManager({
      bridgeUrl: 'http://127.0.0.1:39001',
      token: 'token-1',
      fetchImpl: bridgeFetch,
    });

    const parsed = inputSchema.parse({ action: 'mouse_move', box: [0, 0, 100, 120] });
    await runDesktopControlTool(parsed, manager);
  });

  it('long_press 把 box 中心与 button/ms 发给桥', async () => {
    const bridgeFetch = createBridgeFetch((url, body) => {
      expect(url).toBe('http://127.0.0.1:39001/actions/long_press');
      expect(body).toEqual({ x: 25, y: 25, button: 'right', ms: 1200 });
    });
    const manager = createDesktopControlManager({
      bridgeUrl: 'http://127.0.0.1:39001',
      token: 'token-1',
      fetchImpl: bridgeFetch,
    });

    const parsed = inputSchema.parse({
      action: 'long_press',
      box: [0, 0, 50, 50],
      button: 'right',
      ms: 1200,
    });
    await runDesktopControlTool(parsed, manager);
  });
});

describe('desktop_control manager 新动作转桥', () => {
  it('drag 发到 /actions/drag 且字段为 camelCase', async () => {
    const bridgeFetch = createBridgeFetch((url, body) => {
      expect(url).toBe('http://127.0.0.1:39001/actions/drag');
      expect(body).toEqual({
        fromX: 1,
        fromY: 2,
        toX: 30,
        toY: 40,
        button: 'middle',
        ms: 500,
      });
    });
    const manager = createDesktopControlManager({
      bridgeUrl: 'http://127.0.0.1:39001',
      token: 'token-1',
      fetchImpl: bridgeFetch,
    });

    const output = await manager.drag({
      action: 'drag',
      fromX: 1,
      fromY: 2,
      toX: 30,
      toY: 40,
      button: 'middle',
      ms: 500,
    });

    expect(output).toEqual({ success: true });
  });

  it('mouseMove 发到 /actions/mouse_move', async () => {
    const bridgeFetch = createBridgeFetch((url, body) => {
      expect(url).toBe('http://127.0.0.1:39001/actions/mouse_move');
      expect(body).toEqual({ x: 7, y: 8 });
    });
    const manager = createDesktopControlManager({
      bridgeUrl: 'http://127.0.0.1:39001',
      token: 'token-1',
      fetchImpl: bridgeFetch,
    });

    await manager.mouseMove({ action: 'mouse_move', x: 7, y: 8 });
  });

  it('longPress 发到 /actions/long_press', async () => {
    const bridgeFetch = createBridgeFetch((url, body) => {
      expect(url).toBe('http://127.0.0.1:39001/actions/long_press');
      expect(body).toEqual({ x: 3, y: 4, button: 'left', ms: 900 });
    });
    const manager = createDesktopControlManager({
      bridgeUrl: 'http://127.0.0.1:39001',
      token: 'token-1',
      fetchImpl: bridgeFetch,
    });

    await manager.longPress({ action: 'long_press', x: 3, y: 4, button: 'left', ms: 900 });
  });
});

describe('desktop_control status 旧桥兼容', () => {
  const legacyCapabilities = {
    screenshot: { available: true, driver: 'grim' },
    click: { available: true, driver: 'xdotool' },
    typeText: { available: true, driver: 'xdotool' },
    key: { available: true, driver: 'xdotool' },
    hotkey: { available: true, driver: 'xdotool' },
    scroll: { available: true, driver: 'xdotool' },
    wait: { available: true, driver: 'std-thread-sleep' },
  };

  it('缺少 drag/mouseMove/longPress 能力位时仍能解析', () => {
    const parsed = desktopControlBridgeStatusSchema.safeParse({
      enabled: true,
      capabilities: legacyCapabilities,
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.capabilities?.drag).toBeUndefined();
    expect(parsed.success && parsed.data.capabilities?.mouseMove).toBeUndefined();
    expect(parsed.success && parsed.data.capabilities?.longPress).toBeUndefined();
  });

  it('manager.status() 对旧桥 payload 不抛错', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ enabled: true, capabilities: legacyCapabilities }),
    );
    const manager = createDesktopControlManager({
      bridgeUrl: 'http://127.0.0.1:39001',
      token: 'token-1',
      fetchImpl,
    });

    const status = await manager.status();

    expect(status).toEqual({ enabled: true, capabilities: legacyCapabilities });
  });

  it('新桥返回的能力位会被保留', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        enabled: true,
        capabilities: {
          ...legacyCapabilities,
          drag: { available: true, driver: 'xdotool' },
          mouseMove: { available: true, driver: 'xdotool' },
          longPress: { available: true, driver: 'xdotool' },
        },
      }),
    );
    const manager = createDesktopControlManager({
      bridgeUrl: 'http://127.0.0.1:39001',
      token: 'token-1',
      fetchImpl,
    });

    const status = await manager.status();

    expect(status.capabilities?.drag).toEqual({ available: true, driver: 'xdotool' });
    expect(status.capabilities?.mouseMove).toEqual({ available: true, driver: 'xdotool' });
    expect(status.capabilities?.longPress).toEqual({ available: true, driver: 'xdotool' });
  });
});
