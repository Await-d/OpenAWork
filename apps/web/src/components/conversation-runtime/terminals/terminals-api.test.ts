// @vitest-environment jsdom
/**
 * 契约 §3.1 覆盖：`snapshot` / `output` 载荷解析必须同时支持新字段
 * （`seq` + 增量 `data`）与旧后端的累积 tail（`outputTail`），
 * 以及 `openTerminalStream` 的事件接线。
 *
 * T-06 追加：list 载荷必须原样透传 `backend` / `supportsResize`。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  listSessionTerminals,
  openTerminalStream,
  parseTerminalOutputPayload,
  parseTerminalSnapshotPayload,
} from './terminals-api.js';

describe('listSessionTerminals', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('list 载荷原样透传 backend / supportsResize（缺失时保持 undefined）', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            terminals: [
              {
                terminalId: 'term_pty',
                sessionId: 'session-1',
                toolName: 'quick_terminal',
                kind: 'foreground',
                command: '(交互终端)',
                cwd: '/tmp',
                status: 'running',
                startedAtMs: 1,
                lastActivityMs: 2,
                outputBytesTotal: 0,
                outputTail: '',
                backend: 'pty',
                supportsResize: true,
              },
              {
                terminalId: 'term_legacy',
                sessionId: 'session-1',
                toolName: 'quick_terminal',
                kind: 'foreground',
                command: '(交互终端)',
                cwd: '/tmp',
                status: 'running',
                startedAtMs: 1,
                lastActivityMs: 2,
                outputBytesTotal: 0,
                outputTail: '',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await listSessionTerminals({
      gatewayUrl: 'https://gateway.test',
      sessionId: 'session-1',
      token: 'token-1',
    });

    expect(result.terminals[0]?.backend).toBe('pty');
    expect(result.terminals[0]?.supportsResize).toBe(true);
    // 旧网关不带能力字段：消费方按「未知 = 维持原行为」处理，不能被解析层改写成 false。
    expect(result.terminals[1]?.backend).toBeUndefined();
    expect(result.terminals[1]?.supportsResize).toBeUndefined();
  });
});

describe('parseTerminalSnapshotPayload', () => {
  it('解析新契约载荷（seq + data）', () => {
    const parsed = parseTerminalSnapshotPayload(
      {
        terminalId: 'term_1',
        seq: 42,
        data: 'hello ring buffer',
        outputBytesTotal: 1234,
        status: 'running',
      },
      'term_fallback',
    );

    expect(parsed).toEqual({
      terminalId: 'term_1',
      seq: 42,
      data: 'hello ring buffer',
      outputBytesTotal: 1234,
      status: 'running',
    });
  });

  it('旧后端只有 outputTail 时回退成 data 且 seq 记 0', () => {
    const parsed = parseTerminalSnapshotPayload(
      { terminalId: 'term_old', outputTail: 'legacy tail', outputBytesTotal: 7, status: 'idle' },
      'term_fallback',
    );

    expect(parsed.data).toBe('legacy tail');
    expect(parsed.seq).toBe(0);
    expect(parsed.outputBytesTotal).toBe(7);
  });

  it('缺失 terminalId 时使用事件绑定的兜底 id', () => {
    const parsed = parseTerminalSnapshotPayload({ seq: 1 }, 'term_bound');
    expect(parsed.terminalId).toBe('term_bound');
    expect(parsed.data).toBe('');
    expect(parsed.status).toBe('unknown');
  });

  it('非对象载荷抛错（交由 onError 通道）', () => {
    expect(() => parseTerminalSnapshotPayload('not-json-object', 'term')).toThrow();
    expect(() => parseTerminalSnapshotPayload(null, 'term')).toThrow();
  });
});

describe('parseTerminalOutputPayload', () => {
  it('解析新契约增量载荷', () => {
    const parsed = parseTerminalOutputPayload({
      seq: 9,
      data: 'delta text',
      outputTail: 'tail text',
      outputBytesTotal: 99,
    });

    expect(parsed).toEqual({
      seq: 9,
      data: 'delta text',
      outputTail: 'tail text',
      outputBytesTotal: 99,
    });
  });

  it('旧后端缺省 seq/data 时保持字段缺省（走 tail-diff 兼容路径）', () => {
    const parsed = parseTerminalOutputPayload({
      outputTail: 'cumulative tail',
      outputBytesTotal: 12,
    });

    expect(parsed.seq).toBeUndefined();
    expect(parsed.data).toBeUndefined();
    expect(parsed.outputTail).toBe('cumulative tail');
    expect(parsed.outputBytesTotal).toBe(12);
  });

  it('outputBytesTotal 非法时归零而不是 NaN', () => {
    expect(parseTerminalOutputPayload({ outputBytesTotal: Number.NaN }).outputBytesTotal).toBe(0);
    expect(parseTerminalOutputPayload({}).outputBytesTotal).toBe(0);
  });

  it('非对象载荷抛错', () => {
    expect(() => parseTerminalOutputPayload(undefined)).toThrow();
  });
});

class MockEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: MockEventSource[] = [];

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSED = 2;
  readyState = 0;
  readonly url: string;
  private readonly listeners = new Map<string, Array<(event: Event) => void>>();

  constructor(url: string | URL) {
    this.url = String(url);
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: (event: Event) => void): void {
    const bucket = this.listeners.get(type) ?? [];
    bucket.push(handler);
    this.listeners.set(type, bucket);
  }

  close(): void {
    this.readyState = MockEventSource.CLOSED;
  }

  emit(type: string, payload?: unknown): void {
    const event =
      payload === undefined ? new Event(type) : ({ data: JSON.stringify(payload) } as MessageEvent);
    for (const handler of this.listeners.get(type) ?? []) {
      handler(event);
    }
  }
}

describe('openTerminalStream', () => {
  afterEach(() => {
    MockEventSource.instances = [];
    vi.unstubAllGlobals();
  });

  function openWithSpies() {
    vi.stubGlobal('EventSource', MockEventSource);
    const onSnapshot = vi.fn();
    const onOutput = vi.fn();
    const onExited = vi.fn();
    const onError = vi.fn();
    const onStatus = vi.fn();

    const source = openTerminalStream({
      gatewayUrl: 'https://gateway.test',
      sessionId: 'session-1',
      terminalId: 'term_1',
      token: 'token-1',
      onSnapshot,
      onOutput,
      onExited,
      onError,
      onStatus,
    });

    const mock = MockEventSource.instances[0];
    if (!mock) throw new Error('EventSource 未被构造');
    return { source, mock, onSnapshot, onOutput, onExited, onError, onStatus };
  }

  it('用真实 URL 构造 EventSource 并上报连接状态', () => {
    const { mock, onStatus } = openWithSpies();

    expect(mock.url).toBe(
      'https://gateway.test/sessions/session-1/terminals/term_1/stream?token=token-1',
    );
    expect(onStatus).toHaveBeenCalledWith('connecting');

    mock.emit('open');
    expect(onStatus).toHaveBeenCalledWith('open');
  });

  it('snapshot / output / exited 事件解析后交给回调', () => {
    const { mock, onSnapshot, onOutput, onExited } = openWithSpies();

    mock.emit('snapshot', { seq: 3, data: 'ring', outputBytesTotal: 4, status: 'running' });
    expect(onSnapshot).toHaveBeenCalledWith({
      terminalId: 'term_1',
      seq: 3,
      data: 'ring',
      outputBytesTotal: 4,
      status: 'running',
    });

    mock.emit('output', { seq: 5, data: 'next', outputBytesTotal: 9 });
    expect(onOutput).toHaveBeenCalledWith({ seq: 5, data: 'next', outputBytesTotal: 9 });

    mock.emit('exited', { status: 'exited', exitCode: 0 });
    expect(onExited).toHaveBeenCalledWith({ status: 'exited', exitCode: 0 });
  });

  it('载荷非法时走 onError 而不是抛出', () => {
    const { mock, onError, onSnapshot } = openWithSpies();

    mock.emit('snapshot', 'not-an-object');

    expect(onSnapshot).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('连接被彻底关闭时上报 closed + error，重连中上报 reconnecting', () => {
    const { mock, onError, onStatus } = openWithSpies();

    mock.readyState = MockEventSource.CONNECTING;
    mock.emit('error');
    expect(onStatus).toHaveBeenCalledWith('reconnecting');

    mock.readyState = MockEventSource.CLOSED;
    mock.emit('error');
    expect(onStatus).toHaveBeenCalledWith('closed');
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
