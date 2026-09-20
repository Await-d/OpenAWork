import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpError } from '../gateway/http.js';
import type { TerminalSocketHandlers } from './session-terminals.js';
import { createSessionTerminalsClient, openTerminalSocket } from './session-terminals.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createSessionTerminalsClient', () => {
  it('list 成功时返回 terminals 列表', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          terminals: [
            {
              terminalId: 'term-1',
              sessionId: 'session-1',
              toolName: 'bash',
              kind: 'foreground',
              command: 'echo hi',
              cwd: '/workspace/demo',
              status: 'running',
              startedAtMs: 1,
              lastActivityMs: 1,
              outputBytesTotal: 0,
              outputTail: '',
            },
          ],
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSessionTerminalsClient('http://localhost:3000');
    const result = await client.list('token-1', 'session-1');

    expect(result.terminals[0]?.terminalId).toBe('term-1');
  });

  it('list 在 session_not_found 时给出中文文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'session_not_found' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSessionTerminalsClient('http://localhost:3000');

    await expect(client.list('token-1', 'session-1')).rejects.toThrow(
      '目标会话不存在，无法读取终端列表。',
    );
  });

  it('remove 在 terminal_running 时保留冲突语义', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 409,
        json: async () => ({
          error: 'terminal_running',
          message: 'Kill the terminal before deleting the record.',
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSessionTerminalsClient('http://localhost:3000');

    await expect(client.remove('token-1', 'session-1', 'term-1')).rejects.toThrow(
      '终端仍在运行，请先终止后再清理。',
    );
  });

  it('writeStdin 在 terminal_not_persistent 时返回明确错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 409,
        json: async () => ({
          error: 'terminal_not_persistent',
          message: '该终端是 agent 的一次性命令，不支持继续输入。',
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSessionTerminalsClient('http://localhost:3000');

    await expect(
      client.writeStdin('token-1', 'session-1', 'term-1', { data: 'ls\n' }),
    ).rejects.toThrow('该终端是一次性命令，不支持继续输入。');
  });

  it('create 在 spawn_failed 时保留后端 message', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 500,
        json: async () => ({
          error: 'spawn_failed',
          message: 'pty binary missing',
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSessionTerminalsClient('http://localhost:3000');

    await expect(client.create('token-1', 'session-1')).rejects.toThrow(
      '创建终端失败：pty binary missing',
    );
  });

  it('rename 网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createSessionTerminalsClient('http://localhost:3000');

    await expect(
      client.rename('token-1', 'session-1', 'term-1', { name: 'build logs' }),
    ).rejects.toThrow('网络异常，重命名终端失败。');
  });

  it('kill 失败时会抛 HttpError 并保留状态码', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'terminal_not_found' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSessionTerminalsClient('http://localhost:3000');

    try {
      await client.kill('token-1', 'session-1', 'term-1');
      throw new Error('expected kill to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(404);
      expect((error as Error).message).toContain('目标终端不存在');
    }
  });

  it('create 会读取 ApiErrorResponse.data.message', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 400,
        json: async () => ({
          name: 'BadRequest',
          data: { message: '请求体参数无效。', kind: 'Body' },
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSessionTerminalsClient('http://localhost:3000');

    await expect(client.create('token-1', 'session-1')).rejects.toThrow('请求体参数无效。');
  });

  it('listShellProfiles 请求宿主级端点，载荷不含路径字段', async () => {
    const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) => {
      return {
        ok: true,
        json: async () => ({
          profiles: [
            { id: 'bash', label: 'Bash', isDefault: true },
            { id: 'zsh', label: 'Zsh', isDefault: false },
          ],
        }),
      } as unknown as Response;
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = createSessionTerminalsClient('http://localhost:3000');
    const { profiles } = await client.listShellProfiles('token-1');

    expect(profiles).toEqual([
      { id: 'bash', label: 'Bash', isDefault: true },
      { id: 'zsh', label: 'Zsh', isDefault: false },
    ]);
    const requestedUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestedUrl).toBe('http://localhost:3000/terminals/shell-profiles');
    for (const profile of profiles) {
      expect(profile).not.toHaveProperty('shell');
    }
  });

  it('create 会把 shellProfileId 放进请求体，且缺省时不发送该字段', async () => {
    const bodies: string[] = [];
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''));
      return {
        ok: true,
        json: async () => ({ terminal: { terminalId: 'term-1' } }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const client = createSessionTerminalsClient('http://localhost:3000');
    await client.create('token-1', 'session-1', { shellProfileId: 'zsh' });
    await client.create('token-1', 'session-1');

    expect(JSON.parse(bodies[0] ?? '{}')).toMatchObject({ shellProfileId: 'zsh' });
    expect(JSON.parse(bodies[1] ?? '{}')).not.toHaveProperty('shellProfileId');
  });

  it('create 在 invalid_shell_profile 时给出可操作的中文文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 400,
        json: async () => ({
          error: 'invalid_shell_profile',
          message: '指定的 Shell 配置不存在或不可用。',
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSessionTerminalsClient('http://localhost:3000');

    await expect(
      client.create('token-1', 'session-1', { shellProfileId: '/bin/evil' }),
    ).rejects.toThrow('所选 Shell 配置在此机器上不可用，请重新选择。');
  });
});

// ─── 终端 WebSocket ──────────────────────────────────────────────────────

class MockTerminalWebSocket {
  static instances: MockTerminalWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  readyState = MockTerminalWebSocket.OPEN;
  sentPayloads: string[] = [];
  closeCalls = 0;
  url: string;

  constructor(url: string) {
    this.url = url;
    MockTerminalWebSocket.instances.push(this);
  }

  send(payload: string) {
    this.sentPayloads.push(payload);
  }

  close() {
    this.closeCalls += 1;
    this.readyState = MockTerminalWebSocket.CLOSED;
  }
}

function installMockWebSocket(): void {
  vi.stubGlobal('WebSocket', MockTerminalWebSocket as unknown as typeof WebSocket);
}

function createSocketHandlers() {
  return {
    onOpen: vi.fn(),
    onSnapshot: vi.fn(),
    onOutput: vi.fn(),
    onExit: vi.fn(),
    onError: vi.fn(),
    onClose: vi.fn(),
  };
}

function openSocket(
  handlers: TerminalSocketHandlers,
  overrides: {
    gatewayUrl?: string;
    accessToken?: string;
    sessionId?: string;
    terminalId?: string;
    afterSeq?: number;
  } = {},
) {
  return openTerminalSocket({
    gatewayUrl: overrides.gatewayUrl ?? 'http://localhost:3000',
    accessToken: overrides.accessToken ?? 'token-1',
    sessionId: overrides.sessionId ?? 'session-1',
    terminalId: overrides.terminalId ?? 'term-1',
    ...(overrides.afterSeq !== undefined ? { afterSeq: overrides.afterSeq } : {}),
    handlers,
  });
}

function emitFrame(ws: MockTerminalWebSocket, frame: unknown): void {
  ws.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent);
}

afterEach(() => {
  MockTerminalWebSocket.instances.length = 0;
  vi.unstubAllGlobals();
});

describe('openTerminalSocket URL 构造', () => {
  it('拼接 ws 地址并携带 token 查询参数', () => {
    installMockWebSocket();
    const socket = openSocket(createSocketHandlers());

    expect(socket.state).toBe('connecting');
    expect(MockTerminalWebSocket.instances[0]?.url).toBe(
      'ws://localhost:3000/sessions/session-1/terminals/term-1/ws?token=token-1',
    );
  });

  it('https 升级为 wss，afterSeq 存在时追加为查询参数', () => {
    installMockWebSocket();
    openSocket(createSocketHandlers(), {
      gatewayUrl: 'https://gateway.example.com',
      accessToken: 'token-2',
      afterSeq: 7,
    });

    expect(MockTerminalWebSocket.instances[0]?.url).toBe(
      'wss://gateway.example.com/sessions/session-1/terminals/term-1/ws?token=token-2&afterSeq=7',
    );
  });

  it('sessionId / terminalId 会被 URL 编码', () => {
    installMockWebSocket();
    openSocket(createSocketHandlers(), { sessionId: 'session/1', terminalId: 'term 1' });

    expect(MockTerminalWebSocket.instances[0]?.url).toBe(
      'ws://localhost:3000/sessions/session%2F1/terminals/term%201/ws?token=token-1',
    );
  });
});

describe('openTerminalSocket 帧分发', () => {
  it('snapshot 帧按协议载荷分发（含 interactive）', () => {
    installMockWebSocket();
    const handlers = createSocketHandlers();
    openSocket(handlers);
    const ws = MockTerminalWebSocket.instances[0]!;

    emitFrame(ws, {
      type: 'snapshot',
      terminalId: 'term-1',
      seq: 3,
      data: 'hello',
      outputBytesTotal: 5,
      status: 'running',
      interactive: true,
    });

    expect(handlers.onSnapshot).toHaveBeenCalledWith({
      terminalId: 'term-1',
      seq: 3,
      data: 'hello',
      outputBytesTotal: 5,
      status: 'running',
      interactive: true,
    });
  });

  it('snapshot 缺省 interactive 时不下发该字段', () => {
    installMockWebSocket();
    const handlers = createSocketHandlers();
    openSocket(handlers);
    const ws = MockTerminalWebSocket.instances[0]!;

    emitFrame(ws, {
      type: 'snapshot',
      terminalId: 'term-1',
      seq: 0,
      data: '',
      outputBytesTotal: 0,
      status: 'idle',
    });

    const payload = handlers.onSnapshot.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('interactive');
    expect(handlers.onSnapshot).toHaveBeenCalledWith({
      terminalId: 'term-1',
      seq: 0,
      data: '',
      outputBytesTotal: 0,
      status: 'idle',
    });
  });

  it('output 帧分发增量输出', () => {
    installMockWebSocket();
    const handlers = createSocketHandlers();
    openSocket(handlers);
    const ws = MockTerminalWebSocket.instances[0]!;

    emitFrame(ws, {
      type: 'output',
      terminalId: 'term-1',
      seq: 12,
      data: 'world',
      outputBytesTotal: 17,
    });

    expect(handlers.onOutput).toHaveBeenCalledWith({
      terminalId: 'term-1',
      seq: 12,
      data: 'world',
      outputBytesTotal: 17,
    });
  });

  it('exit 帧分发 status / exitCode（缺省归一化为 null）', () => {
    installMockWebSocket();
    const handlers = createSocketHandlers();
    openSocket(handlers);
    const ws = MockTerminalWebSocket.instances[0]!;

    emitFrame(ws, { type: 'exit', terminalId: 'term-1', status: 'exited', exitCode: 0 });
    emitFrame(ws, { type: 'exit', terminalId: 'term-1', status: 'killed' });

    expect(handlers.onExit).toHaveBeenNthCalledWith(1, { status: 'exited', exitCode: 0 });
    expect(handlers.onExit).toHaveBeenNthCalledWith(2, { status: 'killed', exitCode: null });
  });

  it('error 帧把 code / message 装进 Error', () => {
    installMockWebSocket();
    const handlers = createSocketHandlers();
    openSocket(handlers);
    const ws = MockTerminalWebSocket.instances[0]!;

    emitFrame(ws, { type: 'error', code: 'terminal_not_found', message: '终端不存在。' });

    const error = handlers.onError.mock.calls[0]?.[0] as (Error & { code?: string }) | undefined;
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe('终端不存在。');
    expect(error?.code).toBe('terminal_not_found');
  });

  it('pong / 未知帧 / 畸形 JSON / 缺字段帧都被静默忽略', () => {
    installMockWebSocket();
    const handlers = createSocketHandlers();
    openSocket(handlers);
    const ws = MockTerminalWebSocket.instances[0]!;

    expect(() => {
      emitFrame(ws, { type: 'pong' });
      emitFrame(ws, { type: 'future-frame', payload: 1 });
      ws.onmessage?.({ data: '{broken-json' } as MessageEvent);
      emitFrame(ws, { type: 'snapshot', terminalId: 'term-1' });
      emitFrame(ws, { type: 'output', terminalId: 'term-1', seq: 'nope' });
    }).not.toThrow();

    expect(handlers.onSnapshot).not.toHaveBeenCalled();
    expect(handlers.onOutput).not.toHaveBeenCalled();
    expect(handlers.onExit).not.toHaveBeenCalled();
    expect(handlers.onError).not.toHaveBeenCalled();
  });
});

describe('openTerminalSocket 发送与关闭语义', () => {
  it('open 后 sendInput / sendResize 序列化为协议帧', () => {
    installMockWebSocket();
    const handlers = createSocketHandlers();
    const socket = openSocket(handlers);
    const ws = MockTerminalWebSocket.instances[0]!;

    ws.onopen?.();
    expect(socket.state).toBe('open');
    expect(handlers.onOpen).toHaveBeenCalledTimes(1);

    socket.sendInput('ls\n');
    socket.sendResize(120, 40);

    expect(ws.sentPayloads).toHaveLength(2);
    expect(JSON.parse(ws.sentPayloads[0] ?? '{}')).toEqual({ type: 'input', data: 'ls\n' });
    expect(JSON.parse(ws.sentPayloads[1] ?? '{}')).toEqual({
      type: 'resize',
      cols: 120,
      rows: 40,
    });
  });

  it('未 open 时 sendInput / sendResize 是 no-op 且不抛错', () => {
    installMockWebSocket();
    const socket = openSocket(createSocketHandlers());
    const ws = MockTerminalWebSocket.instances[0]!;

    expect(socket.state).toBe('connecting');
    expect(() => {
      socket.sendInput('ls\n');
      socket.sendResize(80, 24);
    }).not.toThrow();
    expect(ws.sentPayloads).toHaveLength(0);
  });

  it('close() 幂等，关闭后发送是 no-op', () => {
    installMockWebSocket();
    const socket = openSocket(createSocketHandlers());
    const ws = MockTerminalWebSocket.instances[0]!;

    ws.onopen?.();
    socket.close();
    socket.close();

    expect(socket.state).toBe('closed');
    expect(ws.closeCalls).toBe(1);
    expect(() => socket.sendInput('ls\n')).not.toThrow();
    expect(ws.sentPayloads).toHaveLength(0);
  });

  it('服务端关闭时转发 {code, reason}', () => {
    installMockWebSocket();
    const handlers = createSocketHandlers();
    const socket = openSocket(handlers);
    const ws = MockTerminalWebSocket.instances[0]!;

    ws.onopen?.();
    ws.onclose?.({ code: 1006, reason: 'abnormal closure' } as CloseEvent);

    expect(socket.state).toBe('closed');
    expect(handlers.onClose).toHaveBeenCalledWith({ code: 1006, reason: 'abnormal closure' });
  });

  it('传输层 onerror 上报 Error', () => {
    installMockWebSocket();
    const handlers = createSocketHandlers();
    openSocket(handlers);
    const ws = MockTerminalWebSocket.instances[0]!;

    expect(() => ws.onerror?.()).not.toThrow();
    expect(handlers.onError).toHaveBeenCalledTimes(1);
    expect(handlers.onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });
});
