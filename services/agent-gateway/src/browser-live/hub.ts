/**
 * 浏览器实时预览（P3-core）的每用户扇出中枢。
 *
 * 一个用户对应一条 live session（由 `manager.ts` 保证 max 1）。本模块把该 session 的
 * 事件转成 `BrowserLiveEnvelope` 广播给所有已挂载的 WS sink，并实现 screencast 的
 * **信用背压**：任意时刻只允许一帧在途，controller 回 `ack`（携带 frameSessionId）后
 * 才 `ackScreencastFrame` 并放行下一帧；watchdog 超时则强制放行，避免 controller 卡死
 * 整条链路。
 *
 * `seq` 按用户单调递增；`sink` 只需要 `{ send, isOpen }`，因此单测无需真实 socket。
 */

import { BROWSER_LIVE_HIGH_WATER_FRAMES, BROWSER_LIVE_MAX_FRAME_BYTES } from '@openAwork/shared';
import type {
  BrowserLiveConsolePayload,
  BrowserLiveEnvelope,
  BrowserLiveErrorPayload,
  BrowserLiveFramePayload,
  BrowserLiveNetworkPayload,
  BrowserLiveNodePayload,
} from '@openAwork/shared';
import type {
  BrowserLiveEventLike,
  BrowserLiveHandle,
  BrowserLiveNodeInfoLike,
} from './manager.js';

const DEFAULT_FRAME_ACK_TIMEOUT_MS = 4_000;

export interface BrowserLiveSink {
  send(envelope: BrowserLiveEnvelope): boolean;
  isOpen(): boolean;
}

export interface BrowserLiveHubLogger {
  warn: (fields: unknown, message?: string) => void;
}

export interface BrowserLiveHubOptions {
  frameAckTimeoutMs?: number;
  logger?: BrowserLiveHubLogger;
}

export interface BrowserLiveHub {
  subscribe(userId: string, handle: BrowserLiveHandle, sink: BrowserLiveSink): void;
  unsubscribe(userId: string, sink: BrowserLiveSink): void;
  /** 标记 controller 并启动 screencast（幂等；重复调用只更新 controller）。 */
  beginScreencast(userId: string, sink: BrowserLiveSink): Promise<void>;
  /** 停止 screencast 并清空在途帧/队列（幂等）。 */
  endScreencast(userId: string): Promise<void>;
  /** controller 对某帧的 ack；只有 controller 能释放信用。 */
  ackFrame(userId: string, sink: BrowserLiveSink, frameSessionId: number): Promise<void>;
  subscriberCount(userId: string): number;
}

/**
 * 队列中的一帧：`payload.frameSessionId` 是网关为线路分配的**唯一** id，而
 * `cdpFrameSessionId` 是 CDP 真实的 `Page.screencastFrame.sessionId`（同一 screencast
 * 会话内对所有帧保持不变，不能作为线路唯一标识）。
 */
interface QueuedFrame {
  payload: BrowserLiveFramePayload;
  cdpFrameSessionId: number;
}

interface UserFanout {
  handle: BrowserLiveHandle;
  subscribers: Set<BrowserLiveSink>;
  controller: BrowserLiveSink | null;
  seq: number;
  detach: () => void;
  frameQueue: QueuedFrame[];
  /** 单调递增的线路帧 id 计数器。 */
  frameCounter: number;
  /** 在途帧的线路 id；非 null 时禁止放行下一帧。 */
  awaitedFrameId: number | null;
  /** 在途帧对应的 CDP session id，用于 `ackScreencastFrame`。 */
  awaitedCdpFrameSessionId: number | null;
  ackTimer: ReturnType<typeof setTimeout> | null;
  screencastActive: boolean;
  dropBurstLogged: boolean;
  queueOverflowLogged: boolean;
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function toFramePayload(
  event: Extract<BrowserLiveEventLike, { type: 'screencastFrame' }>,
  wireFrameId: number,
): BrowserLiveFramePayload {
  return {
    mimeType: 'image/jpeg',
    data: event.data,
    deviceWidth: event.deviceWidth,
    deviceHeight: event.deviceHeight,
    offsetTop: event.offsetTop,
    pageScaleFactor: event.pageScaleFactor,
    scrollOffsetX: event.scrollOffsetX,
    scrollOffsetY: event.scrollOffsetY,
    frameSessionId: wireFrameId,
  };
}

function toNetworkPayload(
  event: Extract<BrowserLiveEventLike, { type: 'network' }>,
): BrowserLiveNetworkPayload {
  return {
    phase: event.phase,
    requestId: event.requestId,
    method: event.method,
    url: event.url,
    ...(event.resourceType !== undefined ? { resourceType: event.resourceType } : {}),
    ...(event.status !== undefined ? { status: event.status } : {}),
    ...(event.statusText !== undefined ? { statusText: event.statusText } : {}),
    ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
    ...(event.errorText !== undefined ? { errorText: event.errorText } : {}),
    ...(event.requestHeadersSanitized !== undefined
      ? { requestHeadersSanitized: event.requestHeadersSanitized }
      : {}),
    ...(event.responseHeadersSanitized !== undefined
      ? { responseHeadersSanitized: event.responseHeadersSanitized }
      : {}),
  };
}

class BrowserLiveHubImpl implements BrowserLiveHub {
  private readonly users = new Map<string, UserFanout>();
  private readonly frameAckTimeoutMs: number;
  private readonly logger: BrowserLiveHubLogger;

  constructor(options: BrowserLiveHubOptions = {}) {
    this.frameAckTimeoutMs =
      options.frameAckTimeoutMs ??
      readPositiveIntEnv('BROWSER_LIVE_FRAME_ACK_TIMEOUT_MS', DEFAULT_FRAME_ACK_TIMEOUT_MS);
    this.logger = options.logger ?? console;
  }

  subscribe(userId: string, handle: BrowserLiveHandle, sink: BrowserLiveSink): void {
    let fanout = this.users.get(userId);
    if (!fanout) {
      const detach = handle.session.onEvent((event) => {
        this.handleEvent(userId, event);
      });
      fanout = {
        handle,
        subscribers: new Set(),
        controller: null,
        seq: 0,
        detach,
        frameQueue: [],
        frameCounter: 0,
        awaitedFrameId: null,
        awaitedCdpFrameSessionId: null,
        ackTimer: null,
        screencastActive: false,
        dropBurstLogged: false,
        queueOverflowLogged: false,
      };
      this.users.set(userId, fanout);
    }
    fanout.subscribers.add(sink);
  }

  unsubscribe(userId: string, sink: BrowserLiveSink): void {
    const fanout = this.users.get(userId);
    if (!fanout) {
      return;
    }

    fanout.subscribers.delete(sink);

    if (fanout.controller === sink) {
      // controller 掉线：优先改选下一个订阅者，保持 screencast 不断。
      const next = fanout.subscribers.values().next();
      fanout.controller = next.done ? null : next.value;
    }

    if (fanout.subscribers.size === 0) {
      fanout.detach();
      this.clearAckTimer(fanout);
      fanout.frameQueue.length = 0;
      this.users.delete(userId);
      if (fanout.screencastActive) {
        void this.stopScreencast(fanout);
      }
    }
  }

  async beginScreencast(userId: string, sink: BrowserLiveSink): Promise<void> {
    const fanout = this.users.get(userId);
    if (!fanout) {
      return;
    }
    fanout.controller = sink;
    if (fanout.screencastActive) {
      return;
    }
    await fanout.handle.session.startScreencast();
    fanout.screencastActive = true;
  }

  async endScreencast(userId: string): Promise<void> {
    const fanout = this.users.get(userId);
    if (!fanout) {
      return;
    }
    await this.stopScreencast(fanout);
  }

  async ackFrame(userId: string, sink: BrowserLiveSink, frameSessionId: number): Promise<void> {
    const fanout = this.users.get(userId);
    if (!fanout) {
      return;
    }
    // 只有 controller 的 ack 才释放信用；被动观看者的 ack 一律忽略。
    if (fanout.controller !== sink) {
      return;
    }
    if (fanout.awaitedFrameId !== frameSessionId) {
      return;
    }

    const cdpFrameSessionId = fanout.awaitedCdpFrameSessionId;
    this.clearAckTimer(fanout);
    fanout.awaitedFrameId = null;
    fanout.awaitedCdpFrameSessionId = null;
    if (cdpFrameSessionId !== null) {
      await this.ackSessionFrame(fanout, cdpFrameSessionId);
    }
    this.pumpFrames(userId, fanout);
  }

  subscriberCount(userId: string): number {
    return this.users.get(userId)?.subscribers.size ?? 0;
  }

  private handleEvent(userId: string, event: BrowserLiveEventLike): void {
    const fanout = this.users.get(userId);
    if (!fanout) {
      return;
    }

    switch (event.type) {
      case 'console': {
        const payload: BrowserLiveConsolePayload = {
          level: event.level,
          text: event.text,
          timestamp: event.timestamp,
          ...(event.stack !== undefined ? { stack: event.stack } : {}),
          ...(event.sourceMappedStack !== undefined
            ? { sourceMappedStack: event.sourceMappedStack }
            : {}),
        };
        this.publish(userId, 'console', payload);
        return;
      }
      case 'network':
        this.publish(userId, 'network', toNetworkPayload(event));
        return;
      case 'nav':
        this.publish(userId, 'nav', {
          url: event.url,
          title: event.title,
          timestamp: event.timestamp,
        });
        return;
      case 'pageerror': {
        const payload: BrowserLiveErrorPayload = {
          code: 'page_error',
          message: event.message,
          ...(event.stack !== undefined ? { stack: event.stack } : {}),
          ...(event.sourceMappedStack !== undefined
            ? { sourceMappedStack: event.sourceMappedStack }
            : {}),
        };
        this.publish(userId, 'error', payload);
        return;
      }
      case 'screencastFrame':
        this.handleScreencastFrame(userId, fanout, event);
        return;
      case 'screencastEnd':
        // 无需信封：screencast 的结束由控制路径（control.screencast.stop）负责上报。
        return;
    }
  }

  private handleScreencastFrame(
    userId: string,
    fanout: UserFanout,
    event: Extract<BrowserLiveEventLike, { type: 'screencastFrame' }>,
  ): void {
    if (event.data.length > BROWSER_LIVE_MAX_FRAME_BYTES) {
      if (!fanout.dropBurstLogged) {
        fanout.dropBurstLogged = true;
        this.logger.warn(
          {
            userId,
            frameBytes: event.data.length,
            limit: BROWSER_LIVE_MAX_FRAME_BYTES,
          },
          'browser live frame dropped: exceeds BROWSER_LIVE_MAX_FRAME_BYTES',
        );
      }
      // 超限帧不入队、不下发；但仍需 ack 让 CDP 继续产帧，否则缺少 ack 会静默卡死。
      void this.ackSessionFrame(fanout, event.frameSessionId);
      return;
    }

    fanout.dropBurstLogged = false;

    if (fanout.frameQueue.length >= BROWSER_LIVE_HIGH_WATER_FRAMES) {
      if (!fanout.queueOverflowLogged) {
        fanout.queueOverflowLogged = true;
        this.logger.warn(
          { userId, queued: fanout.frameQueue.length },
          'browser live frame queue is full; dropping frame',
        );
      }
      void this.ackSessionFrame(fanout, event.frameSessionId);
      return;
    }

    fanout.queueOverflowLogged = false;
    fanout.frameCounter += 1;
    fanout.frameQueue.push({
      payload: toFramePayload(event, fanout.frameCounter),
      cdpFrameSessionId: event.frameSessionId,
    });
    this.pumpFrames(userId, fanout);
  }

  private pumpFrames(userId: string, fanout: UserFanout): void {
    if (!fanout.screencastActive) {
      return;
    }
    if (fanout.awaitedFrameId !== null) {
      return;
    }
    if (fanout.subscribers.size === 0) {
      return;
    }

    const next = fanout.frameQueue.shift();
    if (!next) {
      return;
    }

    const frameId = next.payload.frameSessionId;
    const cdpFrameSessionId = next.cdpFrameSessionId;
    fanout.awaitedFrameId = frameId;
    fanout.awaitedCdpFrameSessionId = cdpFrameSessionId;
    this.publish(userId, 'frame', next.payload);

    const timer = setTimeout(() => {
      void this.forceAck(userId, fanout, frameId, cdpFrameSessionId);
    }, this.frameAckTimeoutMs);
    const unrefable = timer as ReturnType<typeof setTimeout> & { unref?: () => void };
    unrefable.unref?.();
    fanout.ackTimer = timer;
  }

  private async forceAck(
    userId: string,
    fanout: UserFanout,
    frameId: number,
    cdpFrameSessionId: number,
  ): Promise<void> {
    if (fanout.awaitedFrameId !== frameId) {
      return;
    }
    this.clearAckTimer(fanout);
    fanout.awaitedFrameId = null;
    fanout.awaitedCdpFrameSessionId = null;
    await this.ackSessionFrame(fanout, cdpFrameSessionId);
    this.pumpFrames(userId, fanout);
  }

  private async ackSessionFrame(fanout: UserFanout, frameSessionId: number): Promise<void> {
    try {
      await fanout.handle.session.ackScreencastFrame(frameSessionId);
    } catch (error) {
      this.logger.warn(
        { err: error, frameSessionId },
        'browser live failed to ack screencast frame',
      );
    }
  }

  private async stopScreencast(fanout: UserFanout): Promise<void> {
    const wasActive = fanout.screencastActive;
    fanout.screencastActive = false;
    fanout.controller = null;
    this.clearAckTimer(fanout);
    fanout.awaitedFrameId = null;
    fanout.awaitedCdpFrameSessionId = null;
    fanout.frameQueue.length = 0;

    if (!wasActive) {
      return;
    }

    try {
      await fanout.handle.session.stopScreencast();
    } catch (error) {
      this.logger.warn({ err: error }, 'browser live failed to stop screencast');
    }
  }

  private clearAckTimer(fanout: UserFanout): void {
    if (!fanout.ackTimer) {
      return;
    }
    clearTimeout(fanout.ackTimer);
    fanout.ackTimer = null;
  }

  private publish(userId: string, ch: BrowserLiveEnvelope['ch'], payload: unknown): void {
    const fanout = this.users.get(userId);
    if (!fanout) {
      return;
    }

    fanout.seq += 1;
    const envelope: BrowserLiveEnvelope = { ch, seq: fanout.seq, ts: Date.now(), payload };
    for (const sink of fanout.subscribers) {
      if (!sink.isOpen()) {
        continue;
      }
      sink.send(envelope);
    }
  }
}

export function createBrowserLiveHub(options: BrowserLiveHubOptions = {}): BrowserLiveHub {
  return new BrowserLiveHubImpl(options);
}

export const browserLiveHub = createBrowserLiveHub();

/** 便捷构造：把 node pick 结果映射为线路协议的 `BrowserLiveNodePayload`。 */
export function toNodePayload(node: BrowserLiveNodeInfoLike): BrowserLiveNodePayload {
  return {
    selector: node.selectorHint,
    nodeName: node.nodeName,
    attributes: node.attributes,
    text: node.text,
    computedStyles: node.computedStyles,
    ...(node.fullComputedStyles !== undefined
      ? { fullComputedStyles: node.fullComputedStyles }
      : {}),
    ...(node.selectorStrategy !== undefined ? { selectorStrategy: node.selectorStrategy } : {}),
    ...(node.selectorUnique !== undefined ? { selectorUnique: node.selectorUnique } : {}),
  };
}
