import { afterEach, describe, expect, it, vi } from 'vitest';
import { BROWSER_LIVE_MAX_FRAME_BYTES } from '@openAwork/shared';
import type { BrowserLiveEnvelope } from '@openAwork/shared';
import { createBrowserLiveHub } from '../../browser-live/hub.js';
import type { BrowserLiveHubLogger, BrowserLiveSink } from '../../browser-live/hub.js';
import type {
  BrowserLiveEventLike,
  BrowserLiveHandle,
  BrowserLiveSessionLike,
} from '../../browser-live/manager.js';

interface TestSink extends BrowserLiveSink {
  sent: BrowserLiveEnvelope[];
}

function createSink(): TestSink {
  const sent: BrowserLiveEnvelope[] = [];
  return {
    sent,
    send: (envelope: BrowserLiveEnvelope) => {
      sent.push(envelope);
      return true;
    },
    isOpen: () => true,
  };
}

function framesOf(sink: TestSink): BrowserLiveEnvelope[] {
  return sink.sent.filter((envelope) => envelope.ch === 'frame');
}

function frameEvent(frameSessionId: number, data = 'frame-data'): BrowserLiveEventLike {
  return {
    type: 'screencastFrame',
    data,
    deviceWidth: 800,
    deviceHeight: 600,
    offsetTop: 0,
    pageScaleFactor: 1,
    scrollOffsetX: 0,
    scrollOffsetY: 0,
    frameSessionId,
    timestamp: Date.now(),
  };
}

function setup(options: { logger?: BrowserLiveHubLogger; frameAckTimeoutMs?: number } = {}): {
  hub: ReturnType<typeof createBrowserLiveHub>;
  handle: BrowserLiveHandle;
  ack: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
  emit: (event: BrowserLiveEventLike) => void;
} {
  const hub = createBrowserLiveHub({
    frameAckTimeoutMs: options.frameAckTimeoutMs ?? 4_000,
    logger: options.logger ?? { warn: vi.fn() },
  });

  const ack = vi.fn().mockResolvedValue(undefined);
  const stop = vi.fn().mockResolvedValue(undefined);
  const start = vi.fn().mockResolvedValue(undefined);
  const detach = vi.fn();
  let handler: ((event: BrowserLiveEventLike) => void) | null = null;

  const session: BrowserLiveSessionLike = {
    start: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    isStarted: () => true,
    getEngine: () => 'chromium',
    supportsScreencast: () => true,
    onEvent: (nextHandler) => {
      handler = nextHandler;
      return detach;
    },
    goto: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn().mockResolvedValue(undefined),
    currentUrl: vi.fn().mockResolvedValue('https://example.com/'),
    currentTitle: vi.fn().mockResolvedValue('Example'),
    startScreencast: start,
    ackScreencastFrame: ack,
    stopScreencast: stop,
    setDeviceMetricsOverride: vi.fn().mockResolvedValue(undefined),
    clearDeviceMetricsOverride: vi.fn().mockResolvedValue(undefined),
    setUserAgentOverride: vi.fn().mockResolvedValue(undefined),
    dispatchInput: vi.fn().mockResolvedValue(undefined),
    nodeAtPoint: vi.fn().mockResolvedValue(null),
    domTree: vi.fn().mockResolvedValue({
      root: { nodeId: 1, backendNodeId: 1, nodeName: 'HTML', attributes: {}, childCount: 0 },
      truncated: false,
    }),
    accessibilitySnapshot: vi.fn().mockResolvedValue({ root: null, nodeCount: 0 }),
    screenshot: vi.fn().mockResolvedValue({ buffer: Buffer.from('x'), mimeType: 'image/png' }),
  };

  return {
    hub,
    handle: { id: 'h1', userId: 'u1', session },
    ack,
    stop,
    start,
    detach,
    emit: (event) => {
      handler?.(event);
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createBrowserLiveHub', () => {
  it('holds exactly one outstanding frame until the controller acks', async () => {
    const { hub, handle, emit, ack } = setup();
    const controller = createSink();
    const viewer = createSink();
    hub.subscribe('u1', handle, controller);
    hub.subscribe('u1', handle, viewer);

    await hub.beginScreencast('u1', controller);
    emit(frameEvent(1));
    emit(frameEvent(2));

    expect(framesOf(controller)).toHaveLength(1);
    expect(framesOf(viewer)).toHaveLength(1);
    expect(ack).not.toHaveBeenCalled();

    // 被动观看者的 ack 不释放信用。
    await hub.ackFrame('u1', viewer, 1);
    expect(ack).not.toHaveBeenCalled();
    expect(framesOf(controller)).toHaveLength(1);

    await hub.ackFrame('u1', controller, 1);
    expect(ack).toHaveBeenCalledWith(1);
    expect(framesOf(controller)).toHaveLength(2);
    const second = framesOf(controller)[1]?.payload as { frameSessionId: number };
    expect(second.frameSessionId).toBe(2);
  });

  it('assigns a unique wire frameSessionId even when CDP reuses its screencast session id', async () => {
    const { hub, handle, emit, ack } = setup();
    const controller = createSink();
    hub.subscribe('u1', handle, controller);
    await hub.beginScreencast('u1', controller);

    // 关键事实：Chromium 的 `Page.screencastFrame.sessionId` 在同一个 screencast
    // 会话内对所有帧保持不变（只有重新 startScreencast 才会递增）。因此网关不能把
    // 它直接当作线路上的「帧唯一标识」下发，否则每一帧都会携带同一个 id，消费端会
    // 按 id 去重而丢掉后续所有帧。
    const wireIds: number[] = [];
    for (const label of ['a', 'b', 'c']) {
      emit(frameEvent(7, `frame-${label}`));
      const latest = framesOf(controller).at(-1)?.payload as { frameSessionId: number };
      wireIds.push(latest.frameSessionId);
      await hub.ackFrame('u1', controller, latest.frameSessionId);
    }

    expect(framesOf(controller)).toHaveLength(3);
    // 线路 id 必须逐帧唯一且单调递增。
    expect(new Set(wireIds).size).toBe(wireIds.length);
    expect(wireIds).toEqual([...wireIds].sort((left, right) => left - right));
    // ack 回传给 CDP 的必须是真实 CDP session id，而不是合成的线路 id。
    expect(ack).toHaveBeenCalledWith(7);
    expect(ack).toHaveBeenCalledTimes(3);
  });

  it('force-acks after the watchdog timeout so a lagging controller cannot deadlock', async () => {
    vi.useFakeTimers();
    const { hub, handle, emit, ack } = setup({ frameAckTimeoutMs: 1_000 });
    const controller = createSink();
    hub.subscribe('u1', handle, controller);
    await hub.beginScreencast('u1', controller);

    emit(frameEvent(1));
    emit(frameEvent(2));
    expect(framesOf(controller)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1_100);

    expect(ack).toHaveBeenCalledWith(1);
    expect(framesOf(controller)).toHaveLength(2);
  });

  it('drops oversized frames and logs at most once per drop-burst', async () => {
    const logger = { warn: vi.fn() };
    const { hub, handle, emit, ack } = setup({ logger });
    const controller = createSink();
    hub.subscribe('u1', handle, controller);
    await hub.beginScreencast('u1', controller);

    const oversized = 'x'.repeat(BROWSER_LIVE_MAX_FRAME_BYTES + 1);
    emit(frameEvent(1, oversized));
    emit(frameEvent(2, oversized));

    expect(framesOf(controller)).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    // 超限帧仍要 ack，否则 CDP 侧会因缺少 ack 停止产帧。
    expect(ack).toHaveBeenCalledTimes(2);
  });

  it('maps session events to wire envelopes and skips screencastEnd', async () => {
    const { hub, handle, emit } = setup();
    const controller = createSink();
    hub.subscribe('u1', handle, controller);

    emit({ type: 'console', level: 'log', text: 'hi', timestamp: 1 });
    emit({ type: 'network', phase: 'request', requestId: 'r1', method: 'GET', url: 'https://x/' });
    emit({ type: 'nav', url: 'https://x/', title: 'X', timestamp: 2 });
    emit({ type: 'pageerror', message: 'boom', timestamp: 3 });
    emit({ type: 'screencastEnd' });

    expect(controller.sent.map((envelope) => envelope.ch)).toEqual([
      'console',
      'network',
      'nav',
      'error',
    ]);
    const errorEnvelope = controller.sent[3];
    expect(errorEnvelope?.payload).toMatchObject({ code: 'page_error', message: 'boom' });
    expect(handle.session.onEvent).toBeDefined();
  });

  it('forwards stack and sourceMappedStack when present and omits them when absent', () => {
    const { hub, handle, emit } = setup();
    const controller = createSink();
    hub.subscribe('u1', handle, controller);

    emit({ type: 'console', level: 'error', text: 'plain', timestamp: 1 });
    emit({
      type: 'console',
      level: 'error',
      text: 'with-stack',
      timestamp: 2,
      stack: [{ url: 'http://localhost/assets/app.js', line: 1, column: 2, functionName: 'boom' }],
      sourceMappedStack: [
        {
          url: 'http://localhost/assets/app.js',
          line: 1,
          column: 2,
          functionName: 'boom',
          source: 'export const x = 1;',
          sourceLine: 10,
          sourceColumn: 4,
          sourceName: 'src/main.tsx',
          mapped: true,
        },
      ],
    });
    emit({ type: 'pageerror', message: 'kaput', timestamp: 3 });
    emit({
      type: 'pageerror',
      message: 'kaput-with-stack',
      timestamp: 4,
      stack: [{ url: 'http://localhost/assets/app.js', line: 5, column: 6 }],
    });

    const envelopes = controller.sent.filter(
      (envelope) => envelope.ch === 'console' || envelope.ch === 'error',
    );
    expect(envelopes).toHaveLength(4);

    const plainConsole = envelopes[0]?.payload as Record<string, unknown>;
    expect('stack' in plainConsole).toBe(false);
    expect('sourceMappedStack' in plainConsole).toBe(false);

    const stackedConsole = envelopes[1]?.payload as {
      stack?: unknown[];
      sourceMappedStack?: Array<{ mapped: boolean; sourceName: string | null }>;
    };
    expect(stackedConsole.stack).toHaveLength(1);
    expect(stackedConsole.sourceMappedStack?.[0]?.mapped).toBe(true);
    expect(stackedConsole.sourceMappedStack?.[0]?.sourceName).toBe('src/main.tsx');

    const plainError = envelopes[2]?.payload as Record<string, unknown>;
    expect('stack' in plainError).toBe(false);
    expect('sourceMappedStack' in plainError).toBe(false);

    const stackedError = envelopes[3]?.payload as { stack?: unknown[] };
    expect(stackedError.stack).toHaveLength(1);
  });

  it('detaches the session listener and stops the screencast when the last sink leaves', async () => {
    const { hub, handle, detach, stop } = setup();
    const controller = createSink();
    hub.subscribe('u1', handle, controller);
    await hub.beginScreencast('u1', controller);

    expect(hub.subscriberCount('u1')).toBe(1);

    hub.unsubscribe('u1', controller);

    expect(hub.subscriberCount('u1')).toBe(0);
    expect(detach).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('elects a remaining subscriber as controller when the controller leaves', async () => {
    const { hub, handle, emit, stop } = setup();
    const controller = createSink();
    const viewer = createSink();
    hub.subscribe('u1', handle, controller);
    hub.subscribe('u1', handle, viewer);
    await hub.beginScreencast('u1', controller);

    hub.unsubscribe('u1', controller);

    expect(hub.subscriberCount('u1')).toBe(1);
    expect(stop).not.toHaveBeenCalled();

    emit(frameEvent(9));
    expect(framesOf(viewer)).toHaveLength(1);
  });
});
