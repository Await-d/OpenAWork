import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BROWSER_LIVE_BINARY_FRAME_KIND,
  BROWSER_LIVE_HIGH_WATER_FRAMES,
  BROWSER_LIVE_MAX_FRAME_BYTES,
} from '@openAwork/shared';
import type { BrowserLiveEnvelope } from '@openAwork/shared';
import {
  BROWSER_LIVE_FAST_FRAME_STREAK,
  BROWSER_LIVE_MIN_QUALITY,
  BROWSER_LIVE_QUALITY_COOLDOWN_MS,
  BROWSER_LIVE_QUALITY_RECOVER_STEP,
  BROWSER_LIVE_SCREENCAST_MAX_EDGE,
  BROWSER_LIVE_SCREENCAST_QUALITY,
  BROWSER_LIVE_SLOW_FRAME_MS,
  BROWSER_LIVE_SLOW_FRAME_STREAK,
  createBrowserLiveHub,
} from '../../browser-live/hub.js';
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

function setup(
  options: {
    logger?: BrowserLiveHubLogger;
    frameAckTimeoutMs?: number;
    cdpAckFloorMs?: number;
    traceFrames?: boolean;
  } = {},
): {
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
    // 绝大多数用例只关心「帧有没有下发」，不关心 CDP 侧放行节奏：默认关掉限速，
    // 让 ack 同步发生。限速语义由专门的用例单独钉住。
    cdpAckFloorMs: options.cdpAckFloorMs ?? 0,
    traceFrames: options.traceFrames ?? false,
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
    goBack: vi.fn().mockResolvedValue(undefined),
    goForward: vi.fn().mockResolvedValue(undefined),
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
  it('按秒采样帧生命周期指标，不改变默认实时路径', async () => {
    const warn = vi.fn();
    const { hub, handle, emit } = setup({ traceFrames: true, logger: { warn } });
    const controller = createSink();
    hub.subscribe('u1', handle, controller);

    await hub.beginScreencast('u1', controller, { binary: true });
    emit(frameEvent(1, '1234567890'));

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        payloadChars: 10,
        binaryBytes: null,
        produceIntervalMs: null,
        produceFps: null,
        inflightFrames: 1,
        pendingFrame: false,
      }),
      'browser live frame diagnostics',
    );
  });

  /**
   * 背压两段式：CDP 侧收到帧就立即 ack（否则帧率被一个完整往返钉死），controller 侧
   * 只保留最新一帧、未 ack 在途帧受高水位约束。
   */
  it('立即 ack CDP，并在 controller 侧只保最新一帧', async () => {
    const { hub, handle, emit, ack } = setup();
    const controller = createSink();
    const viewer = createSink();
    hub.subscribe('u1', handle, controller);
    hub.subscribe('u1', handle, viewer);

    await hub.beginScreencast('u1', controller);
    emit(frameEvent(1));

    // 首帧下发后立刻把信用还给 CDP：不等客户端消费完。
    expect(ack).toHaveBeenCalledWith(1);
    expect(framesOf(controller)).toHaveLength(1);
    expect(framesOf(viewer)).toHaveLength(1);

    // 第二帧到达时首帧尚未 ack：在途额度未满，可以继续下发。
    emit(frameEvent(2));
    expect(framesOf(controller)).toHaveLength(2);

    // 第三帧仍在下发额度内：在途数达到高水位。
    emit(frameEvent(3));
    expect(framesOf(controller)).toHaveLength(BROWSER_LIVE_HIGH_WATER_FRAMES);

    // 第四帧：在途已达高水位，暂停下发，但只保留最新的第四帧。
    emit(frameEvent(4));
    expect(framesOf(controller)).toHaveLength(BROWSER_LIVE_HIGH_WATER_FRAMES);

    // 被动观看者的 ack 不释放配额。
    const firstWireId = (framesOf(controller)[0]?.payload as { frameSessionId: number })
      .frameSessionId;
    await hub.ackFrame('u1', viewer, firstWireId);
    expect(framesOf(controller)).toHaveLength(BROWSER_LIVE_HIGH_WATER_FRAMES);

    // controller ack 首帧后放行排队中的最新帧（第四帧），而不是更早被顶掉的那帧。
    await hub.ackFrame('u1', controller, firstWireId);
    const delivered = framesOf(controller).map(
      (envelope) => (envelope.payload as { frameSessionId: number }).frameSessionId,
    );
    expect(delivered).toHaveLength(BROWSER_LIVE_HIGH_WATER_FRAMES + 1);
    expect(delivered[delivered.length - 1]).toBeGreaterThan(delivered[1] ?? 0);
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

  it('starts the screencast with the frame size / quality caps', async () => {
    const { hub, handle, start } = setup();
    const controller = createSink();
    hub.subscribe('u1', handle, controller);

    await hub.beginScreencast('u1', controller);

    // 不设上限时每帧都是视口原始像素：客户端每帧都要 base64 解码 + JPEG 解码 +
    // 重绘面板，主线程被吃满后整个应用都会卡。
    expect(start).toHaveBeenCalledWith({
      quality: BROWSER_LIVE_SCREENCAST_QUALITY,
      maxWidth: BROWSER_LIVE_SCREENCAST_MAX_EDGE,
      maxHeight: BROWSER_LIVE_SCREENCAST_MAX_EDGE,
    });
  });

  /**
   * 二进制帧：协商后帧不再经过 JSON + base64，线路上直接是 [kind][headerLen][header][JPEG]。
   * 这是「同样带宽下更清晰、同样清晰下更流畅」的关键一环。
   */
  it('协商二进制后帧走原始字节，不再套 JSON + base64', async () => {
    const { hub, handle, emit } = setup();
    const envelopes: BrowserLiveEnvelope[] = [];
    const binaries: Uint8Array[] = [];
    const sink: BrowserLiveSink = {
      send: (envelope) => {
        envelopes.push(envelope);
        return true;
      },
      isOpen: () => true,
      sendBinary: (data) => {
        binaries.push(data);
        return true;
      },
    };
    hub.subscribe('u1', handle, sink);
    await hub.beginScreencast('u1', sink, { binary: true });

    emit(frameEvent(1, btoa('jpeg-bytes')));

    expect(binaries).toHaveLength(1);
    expect(envelopes.filter((envelope) => envelope.ch === 'frame')).toHaveLength(0);

    const bytes = binaries[0]!;
    expect(bytes[0]).toBe(BROWSER_LIVE_BINARY_FRAME_KIND);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const headerLength = view.getUint32(1, true);
    const header = JSON.parse(new TextDecoder().decode(bytes.subarray(5, 5 + headerLength))) as {
      deviceWidth: number;
      deviceHeight: number;
    };
    expect(header.deviceWidth).toBe(800);
    expect(header.deviceHeight).toBe(600);
    expect(new TextDecoder().decode(bytes.subarray(5 + headerLength))).toBe('jpeg-bytes');
  });

  it('无损档位使用 PNG，且不向 CDP 发送 JPEG quality', async () => {
    const { hub, handle, emit, start } = setup();
    const controller = createSink();
    hub.subscribe('u1', handle, controller);

    await hub.beginScreencast('u1', controller, {
      format: 'png',
      maxWidth: 800,
      maxHeight: 600,
    });
    expect(start).toHaveBeenCalledWith({
      format: 'png',
      maxWidth: 800,
      maxHeight: 600,
    });

    emit(frameEvent(1, 'png-bytes'));
    expect((framesOf(controller)[0]?.payload as { mimeType: string }).mimeType).toBe('image/png');
  });

  /**
   * 推流期间切画质档位必须真的生效。
   *
   * 前端切档只做「解除武装 → 重发 screencast.start」；旧实现只要 screencastActive 就
   * 无条件早退，于是用户在画面跑着的时候降档/升档毫无反应，必须收起面板或断线重连。
   */
  it('推流期间定档变化会以新参数重开 screencast，参数没变则不重开', async () => {
    const { hub, handle, start } = setup();
    const controller = createSink();
    hub.subscribe('u1', handle, controller);

    await hub.beginScreencast('u1', controller, { quality: 50, maxWidth: 800, maxHeight: 600 });
    expect(start).toHaveBeenCalledTimes(1);

    // 定档完全一致（含缺省字段回落到同一默认值）：幂等，不重开。
    await hub.beginScreencast('u1', controller, { quality: 50, maxWidth: 800, maxHeight: 600 });
    expect(start).toHaveBeenCalledTimes(1);

    // 客户端降档：必须带着新参数重开。
    await hub.beginScreencast('u1', controller, { quality: 45, maxWidth: 800, maxHeight: 600 });
    expect(start).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenLastCalledWith({
      quality: 45,
      maxWidth: 800,
      maxHeight: 600,
    });

    // 帧盒变化同样算变更。
    await hub.beginScreencast('u1', controller, { quality: 45, maxWidth: 1024, maxHeight: 768 });
    expect(start).toHaveBeenCalledTimes(3);
    expect(start).toHaveBeenLastCalledWith({
      quality: 45,
      maxWidth: 1024,
      maxHeight: 768,
    });
  });

  it('refreshScreencast 用同一份定档重发 start（强制补一帧）', async () => {
    const { hub, handle, start } = setup();
    const controller = createSink();
    hub.subscribe('u1', handle, controller);
    await hub.beginScreencast('u1', controller);
    expect(start).toHaveBeenCalledTimes(1);

    await hub.refreshScreencast('u1');

    expect(start).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenLastCalledWith({
      quality: BROWSER_LIVE_SCREENCAST_QUALITY,
      maxWidth: BROWSER_LIVE_SCREENCAST_MAX_EDGE,
      maxHeight: BROWSER_LIVE_SCREENCAST_MAX_EDGE,
    });
  });

  it('未推流时 refreshScreencast 无副作用', async () => {
    const { hub, handle, start } = setup();
    const controller = createSink();
    hub.subscribe('u1', handle, controller);

    await hub.refreshScreencast('u1');

    expect(start).not.toHaveBeenCalled();
  });

  /**
   * 首帧可能先于 `startScreencast` 的 resolve 到达（CDP 收到 start 就立刻产帧）。
   * 那一帧既不能被当成「停流残留」丢掉，也绝不能漏 ack —— 漏了 Chromium 就再也不产帧。
   */
  it('起流瞬间到达的首帧会被下发且立即 ack', async () => {
    const { hub, handle, emit, ack, start } = setup();
    const controller = createSink();
    hub.subscribe('u1', handle, controller);

    // 让本次 startScreencast 挂起：此刻 active 已置位但 await 未完成。
    const releaseStart: { current: (() => void) | null } = { current: null };
    start.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        releaseStart.current = resolve;
      }),
    );

    const starting = hub.beginScreencast('u1', controller);
    emit(frameEvent(1));

    expect(framesOf(controller)).toHaveLength(1);
    expect(ack).toHaveBeenCalledWith(1);

    releaseStart.current?.();
    await starting;
  });

  /**
   * 停流之后仍有残留帧：ack 必须还（CDP 的 ack 是逐帧确认的），但不能画给用户。
   */
  it('停流后的残留帧会 ack 但不下发', async () => {
    const { hub, handle, emit, ack } = setup();
    const controller = createSink();
    hub.subscribe('u1', handle, controller);
    await hub.beginScreencast('u1', controller);
    await hub.endScreencast('u1');

    const ackedBefore = ack.mock.calls.length;
    emit(frameEvent(99));

    expect(framesOf(controller)).toHaveLength(0);
    expect(ack.mock.calls.length).toBe(ackedBefore + 1);
    expect(ack).toHaveBeenLastCalledWith(99);
  });

  it('起流失败时回滚 active，不会停在「声称在推流」的状态', async () => {
    const { hub, handle, emit, start, stop } = setup();
    const controller = createSink();
    hub.subscribe('u1', handle, controller);

    start.mockRejectedValueOnce(new Error('boom'));
    await expect(hub.beginScreencast('u1', controller)).rejects.toThrow('boom');

    // 回滚后帧不再下发；stop 也不该被调用（本来就没有流）。
    emit(frameEvent(1));
    expect(framesOf(controller)).toHaveLength(0);
    await hub.endScreencast('u1');
    expect(stop).not.toHaveBeenCalled();
  });

  describe('CDP ack 限速（产帧速率限制器）', () => {
    it('间隔内的帧不立即 ack CDP，到点逐帧放行', async () => {
      vi.useFakeTimers();
      const { hub, handle, emit, ack } = setup({ cdpAckFloorMs: 40 });
      const controller = createSink();
      hub.subscribe('u1', handle, controller);
      await hub.beginScreencast('u1', controller);

      // 首帧：基准为空，立即放行（否则起流要白等一个间隔）。
      emit(frameEvent(1));
      expect(ack).toHaveBeenCalledWith(1);

      // 紧跟的帧落在间隔内：不能立即 ack，否则编码器全速运转抢 CPU。
      emit(frameEvent(2));
      emit(frameEvent(3));
      expect(ack).toHaveBeenCalledTimes(1);

      // 到点逐帧补发：CDP 的 screencastFrameAck 是逐帧协议，不能丢弃旧 sessionId。
      await vi.advanceTimersByTimeAsync(40);
      expect(ack).toHaveBeenCalledTimes(3);
      expect(ack).toHaveBeenNthCalledWith(2, 2);
      expect(ack).toHaveBeenNthCalledWith(3, 3);
    });

    it('限速不影响向客户端下发（只影响 CDP 产帧节奏）', async () => {
      vi.useFakeTimers();
      const { hub, handle, emit } = setup({ cdpAckFloorMs: 40 });
      const controller = createSink();
      hub.subscribe('u1', handle, controller);
      await hub.beginScreencast('u1', controller);

      emit(frameEvent(1));
      emit(frameEvent(2));

      // 两帧都已下发（客户端看到的画面不受限速影响）。
      expect(framesOf(controller)).toHaveLength(2);
    });

    it('交互中取消限速：输入后当帧立即 ack（拖动跟手）', async () => {
      vi.useFakeTimers();
      const { hub, handle, emit, ack } = setup({ cdpAckFloorMs: 40 });
      const controller = createSink();
      hub.subscribe('u1', handle, controller);
      await hub.beginScreencast('u1', controller);

      // 先制造一个「间隔内」的状态：首帧放行后紧跟一帧会被挂起。
      emit(frameEvent(1));
      emit(frameEvent(2));
      expect(ack).toHaveBeenCalledTimes(1);

      // 用户开始拖动：限速必须立刻让位，否则这段等待会原样变成迟滞感。
      hub.noteUserInput('u1');
      // 挂起的那一帧被立即放行。
      expect(ack).toHaveBeenCalledTimes(2);

      // 交互窗口内的后续帧也不再等待。
      emit(frameEvent(3));
      expect(ack).toHaveBeenCalledTimes(3);
      expect(ack).toHaveBeenLastCalledWith(3);
    });

    it('交互窗口过后恢复限速（空闲时把 CPU 让回页面）', async () => {
      vi.useFakeTimers();
      const { hub, handle, emit, ack } = setup({ cdpAckFloorMs: 40 });
      const controller = createSink();
      hub.subscribe('u1', handle, controller);
      await hub.beginScreencast('u1', controller);

      emit(frameEvent(1));
      hub.noteUserInput('u1');
      const afterInput = ack.mock.calls.length;

      // 越过交互窗口：限速重新生效。第一帧因距上次 ack 已超过一个间隔而立即放行…
      await vi.advanceTimersByTimeAsync(300);
      emit(frameEvent(2));
      expect(ack.mock.calls.length).toBe(afterInput + 1);

      // …紧跟的下一帧落在间隔内，必须等待（空闲时把 CPU 让回页面）。
      emit(frameEvent(3));
      expect(ack.mock.calls.length).toBe(afterInput + 1);

      await vi.advanceTimersByTimeAsync(40);
      expect(ack).toHaveBeenLastCalledWith(3);
    });

    it('停流会冲刷已收到的待放行 ack，避免 stop → start 泄漏 CDP credit', async () => {
      vi.useFakeTimers();
      const { hub, handle, emit, ack } = setup({ cdpAckFloorMs: 40 });
      const controller = createSink();
      hub.subscribe('u1', handle, controller);
      await hub.beginScreencast('u1', controller);

      emit(frameEvent(1));
      emit(frameEvent(2));
      await hub.endScreencast('u1');
      // stop 只阻止后续产帧，不能撤销已经收到的 frame 事件；pending sessionId
      // 必须在停流路径冲刷，否则下一次起流可能被旧 credit 卡住。
      expect(ack).toHaveBeenCalledWith(2);
      const ackedAfterStop = ack.mock.calls.length;
      await vi.advanceTimersByTimeAsync(100);

      expect(ack.mock.calls.length).toBe(ackedAfterStop);
    });
  });

  it('restarts the screencast with the same caps after it was stopped', async () => {
    const { hub, handle, emit, start, stop } = setup();
    const controller = createSink();
    hub.subscribe('u1', handle, controller);
    await hub.beginScreencast('u1', controller);

    // 面板隐藏 → 停流：帧不再产出。
    await hub.endScreencast('u1');
    expect(stop).toHaveBeenCalledTimes(1);
    emit(frameEvent(1));
    expect(framesOf(controller)).toHaveLength(0);

    // 重新可见 → 续流，且沿用同一份限帧参数。
    await hub.beginScreencast('u1', controller);
    expect(start).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenLastCalledWith({
      quality: BROWSER_LIVE_SCREENCAST_QUALITY,
      maxWidth: BROWSER_LIVE_SCREENCAST_MAX_EDGE,
      maxHeight: BROWSER_LIVE_SCREENCAST_MAX_EDGE,
    });

    emit(frameEvent(2));
    expect(framesOf(controller)).toHaveLength(1);
  });

  /**
   * 链路跟不上时优先保帧率：连续慢帧后自动降一档 JPEG 质量，而不是让用户对着
   * 卡死的画面等到 4s watchdog。
   */
  it('连续慢帧后自动降一档质量', async () => {
    vi.useFakeTimers();
    const { hub, handle, emit, start } = setup();
    const controller = createSink();
    hub.subscribe('u1', handle, controller);
    await hub.beginScreencast('u1', controller);

    for (let index = 0; index < BROWSER_LIVE_SLOW_FRAME_STREAK; index += 1) {
      emit(frameEvent(index + 1));
      const frame = framesOf(controller).at(-1);
      if (!frame) throw new Error('未下发帧');
      // 每帧都拖到慢帧阈值之外再 ack：模拟客户端解码 / 绘制跟不上。
      await vi.advanceTimersByTimeAsync(BROWSER_LIVE_SLOW_FRAME_MS + 40);
      await hub.ackFrame(
        'u1',
        controller,
        (frame.payload as { frameSessionId: number }).frameSessionId,
      );
    }
    await vi.advanceTimersByTimeAsync(0);

    expect(start).toHaveBeenCalledTimes(2);
    // 步长会撞上下限（50 - 15 = 35 < 40），所以第一次降档直接落到下限。
    expect(start).toHaveBeenLastCalledWith({
      quality: BROWSER_LIVE_MIN_QUALITY,
      maxWidth: BROWSER_LIVE_SCREENCAST_MAX_EDGE,
      maxHeight: BROWSER_LIVE_SCREENCAST_MAX_EDGE,
    });
  });

  /**
   * 产帧不慢、只是客户端排队导致 ack 往返变长时，**不能**降档。
   *
   * 真实场景：客户端解码只要 2ms、网络 10KB/帧，但产帧被限速钳住后，一次往返天然
   * 包含排队时间而超过慢帧阈值。此时降档不会提升帧率，只会让画面更糊——这正是
   * 「又卡又糊、降档也没用」的成因。
   */
  it('产帧速率正常时，仅 ack 往返变长不降档', async () => {
    vi.useFakeTimers();
    const { hub, handle, emit, start } = setup({ cdpAckFloorMs: 40 });
    const controller = createSink();
    hub.subscribe('u1', handle, controller);
    await hub.beginScreencast('u1', controller);

    // 模拟「编码跟得上、但往返慢」：在等待 ack 的这段时间里，页面持续按限速节奏产帧，
    // 因此产帧间隔稳定在 40ms；而被 ack 的那一帧已经等了 250ms 以上。
    let seq = 0;
    const pumpFrame = async (): Promise<void> => {
      seq += 1;
      emit(frameEvent(seq));
      await vi.advanceTimersByTimeAsync(40);
    };

    for (let index = 0; index < BROWSER_LIVE_SLOW_FRAME_STREAK; index += 1) {
      await pumpFrame();
      const frame = framesOf(controller).at(-1);
      if (!frame) throw new Error('未下发帧');
      const wireId = (frame.payload as { frameSessionId: number }).frameSessionId;

      // 往返拖到慢帧阈值之外——期间产帧仍在按 40ms 节奏进行。
      const extraFrames = Math.ceil(BROWSER_LIVE_SLOW_FRAME_MS / 40);
      for (let extra = 0; extra < extraFrames; extra += 1) {
        await pumpFrame();
      }
      await hub.ackFrame('u1', controller, wireId);
    }

    // 全程只有起流那一次 start：没有降档重开。
    expect(start).toHaveBeenCalledTimes(1);
  });

  /**
   * 质量见底后必须改降**分辨率**。
   *
   * 编码成本与像素量成正比，而像素量是边长的平方：只降 JPEG 质量不降帧盒，会让链路慢
   * 的机器卡在「既慢又不够小」的档位上——质量已经到 40 下限，却还在传一百多万像素。
   */
  it('质量已在下限时，继续慢帧会降低帧盒（像素量按平方下降）', async () => {
    vi.useFakeTimers();
    // 从下限质量起流：第一次降档就没有质量可降，必须落到帧盒。
    const { hub, handle, emit, start } = setup();
    const controller = createSink();
    hub.subscribe('u1', handle, controller);
    await hub.beginScreencast('u1', controller, {
      quality: BROWSER_LIVE_MIN_QUALITY,
      maxWidth: 1000,
      maxHeight: 800,
    });

    for (let index = 0; index < BROWSER_LIVE_SLOW_FRAME_STREAK; index += 1) {
      emit(frameEvent(index + 1));
      const frame = framesOf(controller).at(-1);
      if (!frame) throw new Error('未下发帧');
      await vi.advanceTimersByTimeAsync(BROWSER_LIVE_SLOW_FRAME_MS + 40);
      await hub.ackFrame(
        'u1',
        controller,
        (frame.payload as { frameSessionId: number }).frameSessionId,
      );
    }
    await vi.advanceTimersByTimeAsync(0);

    const lastCall = start.mock.calls.at(-1)?.[0] as
      { quality: number; maxWidth: number; maxHeight: number } | undefined;
    if (!lastCall) throw new Error('未重开 screencast');

    // 质量不变（已在下限），帧盒缩小。
    expect(lastCall.quality).toBe(BROWSER_LIVE_MIN_QUALITY);
    expect(lastCall.maxWidth).toBeLessThan(1000);
    expect(lastCall.maxHeight).toBeLessThan(800);
    // 步长 15%：1000 → 850。
    expect(lastCall.maxWidth).toBe(850);
  });

  it('反复降档不会把帧盒缩到下限以下（保证看得清）', async () => {
    vi.useFakeTimers();
    const { hub, handle, emit, start } = setup({ cdpAckFloorMs: 0 });
    const controller = createSink();
    hub.subscribe('u1', handle, controller);
    await hub.beginScreencast('u1', controller, {
      quality: BROWSER_LIVE_MIN_QUALITY,
      maxWidth: 1000,
      maxHeight: 800,
    });

    // 反复触发慢帧窗口（每次都跨过冷却期）。
    for (let round = 0; round < 8; round += 1) {
      for (let index = 0; index < BROWSER_LIVE_SLOW_FRAME_STREAK; index += 1) {
        emit(frameEvent(round * 100 + index + 1));
        const frame = framesOf(controller).at(-1);
        if (!frame) throw new Error('未下发帧');
        await vi.advanceTimersByTimeAsync(BROWSER_LIVE_SLOW_FRAME_MS + 50);
        await hub.ackFrame(
          'u1',
          controller,
          (frame.payload as { frameSessionId: number }).frameSessionId,
        );
      }
      await vi.advanceTimersByTimeAsync(BROWSER_LIVE_QUALITY_COOLDOWN_MS);
    }

    const lastCall = start.mock.calls.at(-1)?.[0] as { maxWidth: number; maxHeight: number };
    // 下限是协商值的 50%。
    expect(lastCall.maxWidth).toBeGreaterThanOrEqual(500);
    expect(lastCall.maxHeight).toBeGreaterThanOrEqual(400);
  });

  /** 链路恢复后质量必须能升回去，否则一次卡顿会让会话永久停在糊画面上。 */
  it('连续快帧且过了冷却期后回升一档质量', async () => {
    vi.useFakeTimers();
    const { hub, handle, emit, start } = setup();
    const controller = createSink();
    hub.subscribe('u1', handle, controller);
    await hub.beginScreencast('u1', controller);

    const feed = async (count: number, elapsedMs: number): Promise<void> => {
      for (let index = 0; index < count; index += 1) {
        emit(frameEvent(index + 1));
        const frame = framesOf(controller).at(-1);
        if (!frame) throw new Error('未下发帧');
        await vi.advanceTimersByTimeAsync(elapsedMs);
        await hub.ackFrame(
          'u1',
          controller,
          (frame.payload as { frameSessionId: number }).frameSessionId,
        );
      }
    };

    // 先制造一段慢帧把质量降到下限。
    await feed(BROWSER_LIVE_SLOW_FRAME_STREAK, BROWSER_LIVE_SLOW_FRAME_MS + 40);
    expect(start).toHaveBeenLastCalledWith(
      expect.objectContaining({ quality: BROWSER_LIVE_MIN_QUALITY }),
    );

    // 再过一段快帧：单帧 50ms（< 快帧阈值 60ms），累计 240 帧 ≈ 12s 以跨过冷却期。
    await feed(BROWSER_LIVE_FAST_FRAME_STREAK * 8, 50);
    await vi.advanceTimersByTimeAsync(0);

    expect(start).toHaveBeenLastCalledWith(
      expect.objectContaining({
        quality: BROWSER_LIVE_MIN_QUALITY + BROWSER_LIVE_QUALITY_RECOVER_STEP,
      }),
    );
  });

  /**
   * 卡死的 controller 不能把链路一起拖死：watchdog 到期后释放它在途配额，让后续帧
   * 继续下发。注意 CDP 侧的 ack 早已在收到帧时就发出，这里回收的只是本地配额。
   */
  it('watchdog 到期释放配额，卡死的 controller 不会阻塞后续帧', async () => {
    vi.useFakeTimers();
    const { hub, handle, emit, ack } = setup({ frameAckTimeoutMs: 1_000 });
    const controller = createSink();
    hub.subscribe('u1', handle, controller);
    await hub.beginScreencast('u1', controller);

    // 打满高水位：三帧都在途，且每帧收到时都已把信用还给 CDP。
    emit(frameEvent(1));
    emit(frameEvent(2));
    emit(frameEvent(3));
    expect(framesOf(controller)).toHaveLength(BROWSER_LIVE_HIGH_WATER_FRAMES);
    expect(ack).toHaveBeenCalledTimes(BROWSER_LIVE_HIGH_WATER_FRAMES);

    // 额度用尽：第四帧只留在 pending 槽里，不下发。
    emit(frameEvent(4));
    expect(framesOf(controller)).toHaveLength(BROWSER_LIVE_HIGH_WATER_FRAMES);

    // controller 一个 ack 都不回：watchdog 逐帧释放配额，第四帧得以下发。
    await vi.advanceTimersByTimeAsync(1_100);
    expect(framesOf(controller)).toHaveLength(BROWSER_LIVE_HIGH_WATER_FRAMES + 1);
  });

  /**
   * watchdog 随实测往返收紧：正常往返只有几十毫秒时，不必等满配置的 4s 才兜底。
   */
  it('watchdog 按实测 ack 往返收紧，且不低于下限', async () => {
    vi.useFakeTimers();
    const { hub, handle, emit } = setup({ frameAckTimeoutMs: 4_000 });
    const controller = createSink();
    hub.subscribe('u1', handle, controller);
    await hub.beginScreencast('u1', controller);

    // 先喂一帧 20ms 往返的样本：watchdog 应收紧到 4 × 20 = 80ms → 抬到 500ms 下限。
    emit(frameEvent(1));
    const first = framesOf(controller).at(-1);
    if (!first) throw new Error('未下发帧');
    await vi.advanceTimersByTimeAsync(20);
    await hub.ackFrame(
      'u1',
      controller,
      (first.payload as { frameSessionId: number }).frameSessionId,
    );

    emit(frameEvent(2));
    emit(frameEvent(3));
    emit(frameEvent(4));
    const before = framesOf(controller).length;
    // 在途配额被占满，第 5 帧只能排队。
    emit(frameEvent(5));
    expect(framesOf(controller)).toHaveLength(before);

    // 远不到 4s，但已超过收紧后的 500ms：配额被释放，第 5 帧下发。
    await vi.advanceTimersByTimeAsync(600);
    expect(framesOf(controller).length).toBeGreaterThan(before);
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
