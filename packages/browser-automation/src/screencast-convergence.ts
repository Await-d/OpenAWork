import { Buffer } from 'node:buffer';

import type { BrowserLiveScreencastOptions } from './live-session-types.js';

/**
 * 设备指标覆写后的 screencast 收敛控制器。
 *
 * Chromium 在视口切换过程中可能产出「元数据已是新尺寸、但位图仍被缩放到旧视口」的
 * 过渡帧（例如请求 1280×800 却收到 768×480 的 JPEG）。静态页面在该过渡帧之后不再
 * 产生 damage，客户端就会永久停在错误尺寸上。控制器在每次设备覆写后重开 screencast，
 * 校验帧的元数据与位图是否都等于目标尺寸；不一致就按固定节奏重试，直到收敛或用尽
 * 有界预算（次数 + 截止时间），因此既不会忙等，也不会无限产帧。
 */

export interface ScreencastFrameDimensions {
  /** CDP `Page.screencastFrame.metadata.deviceWidth/Height`。 */
  metadataWidth: number;
  metadataHeight: number;
  /** 从 JPEG 位图头解析出的真实像素尺寸；解析失败为 null。 */
  bitmapWidth: number | null;
  bitmapHeight: number | null;
}

export interface ScreencastConvergenceTarget {
  width: number;
  height: number;
  /**
   * 起流时的位图缩放上限（`Page.startScreencast` 的 `maxWidth` / `maxHeight`；0 /
   * 缺省 = 该轴不限制）。设了上限后位图会等比缩到盒子里，**不再等于视口尺寸**——
   * 判定必须按同一规则推算期望尺寸，否则每次设备覆写都会空转到预算耗尽。
   */
  bitmapBounds?: ScreencastBitmapBounds;
}

/** 帧位图的缩放上限，与起流参数共用同一份定义，避免两处漂移。 */
export type ScreencastBitmapBounds = Pick<BrowserLiveScreencastOptions, 'maxWidth' | 'maxHeight'>;

/**
 * 位图尺寸的判定容差（像素）。CDP 只承诺「缩放到盒子里」，边界取整方式不属于协议
 * 契约；真正的陈旧帧差距远大于此（如 1280×800 vs 768×480），不会被容差放过。
 */
const BITMAP_SIZE_TOLERANCE_PX = 2;

export interface ScreencastConvergenceOptions {
  target: ScreencastConvergenceTarget;
  /** 重新武装 screencast（幂等；每次调用应立即产出一帧）。 */
  rearm: () => Promise<void>;
  /** 会话是否仍可收敛（screencast 仍在推流、页面仍存活）。 */
  isActive: () => boolean;
  maxAttempts?: number;
  budgetMs?: number;
  retryDelayMs?: number;
  attemptTimeoutMs?: number;
}

const DEFAULT_MAX_ATTEMPTS = 8;
const DEFAULT_BUDGET_MS = 3_500;
const DEFAULT_RETRY_DELAY_MS = 150;
const DEFAULT_ATTEMPT_TIMEOUT_MS = 400;

/** JPEG SOF 标记（含 progressive / 扩展精度），C4/C8/CC 是别的段。 */
function isStartOfFrameMarker(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/**
 * 从 base64 JPEG 中读出真实位图尺寸（只扫描段头，不做解码）。
 *
 * 之所以必须看位图而非 CDP 元数据：过渡帧的元数据已经上报目标尺寸，只有位图能
 * 暴露「画面还停在旧视口」。
 */
export function readJpegDimensions(base64: string): { width: number; height: number } | null {
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === undefined) {
      return null;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const segmentLength = bytes.readUInt16BE(offset + 2);
    if (segmentLength < 2) {
      return null;
    }
    if (isStartOfFrameMarker(marker)) {
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + segmentLength;
  }
  return null;
}

/**
 * 期望的帧位图尺寸：把目标视口按 `bitmapBounds` 等比缩进盒子里（与 CDP 的同一条
 * 规则：只缩不放、取两轴中最小的缩放比）。
 *
 * 没有上限时就是视口尺寸本身，且不放宽容差——保持原来的精确判定语义。
 */
function resolveExpectedBitmapSize(target: ScreencastConvergenceTarget): {
  width: number;
  height: number;
  tolerance: number;
} {
  const maxWidth = target.bitmapBounds?.maxWidth ?? 0;
  const maxHeight = target.bitmapBounds?.maxHeight ?? 0;
  const scale = Math.min(
    1,
    maxWidth > 0 ? maxWidth / target.width : 1,
    maxHeight > 0 ? maxHeight / target.height : 1,
  );
  if (!Number.isFinite(scale) || scale >= 1) {
    return { width: target.width, height: target.height, tolerance: 0 };
  }
  return {
    width: Math.round(target.width * scale),
    height: Math.round(target.height * scale),
    tolerance: BITMAP_SIZE_TOLERANCE_PX,
  };
}

export class ScreencastConvergence {
  private readonly options: ScreencastConvergenceOptions;
  private readonly maxAttempts: number;
  private readonly budgetMs: number;
  private readonly retryDelayMs: number;
  private readonly attemptTimeoutMs: number;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private startedAt = 0;
  private stopped = false;

  constructor(options: ScreencastConvergenceOptions) {
    this.options = options;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.attemptTimeoutMs = options.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
  }

  start(): void {
    if (this.stopped) return;
    this.startedAt = Date.now();
    this.attempt();
  }

  /** 每次收到 screencast 帧都调用；尺寸对上即收敛，否则安排下一轮重试。 */
  noteFrame(dimensions: ScreencastFrameDimensions): void {
    if (this.stopped) return;
    if (this.matchesTarget(dimensions)) {
      this.stop();
      return;
    }
    this.schedule(this.retryDelayMs);
  }

  /** 是否已结束（收敛成功 / 预算耗尽 / 会话不再活跃）。 */
  isSettled(): boolean {
    return this.stopped;
  }

  dispose(): void {
    this.stop();
  }

  private matchesTarget(dimensions: ScreencastFrameDimensions): boolean {
    const { width, height } = this.options.target;
    if (dimensions.metadataWidth !== width || dimensions.metadataHeight !== height) {
      return false;
    }
    const { bitmapWidth, bitmapHeight } = dimensions;
    if (bitmapWidth === null || bitmapHeight === null) {
      return false;
    }
    const expected = resolveExpectedBitmapSize(this.options.target);
    return (
      Math.abs(bitmapWidth - expected.width) <= expected.tolerance &&
      Math.abs(bitmapHeight - expected.height) <= expected.tolerance
    );
  }

  private attempt(): void {
    if (this.stopped) return;
    if (!this.options.isActive()) {
      this.stop();
      return;
    }
    if (this.attempts >= this.maxAttempts || Date.now() - this.startedAt >= this.budgetMs) {
      this.stop();
      return;
    }

    this.attempts += 1;
    void this.options.rearm().catch(() => {
      this.schedule(this.retryDelayMs);
    });
    this.schedule(this.attemptTimeoutMs);
  }

  private schedule(delayMs: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.attempt();
    }, delayMs);
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.clearTimer();
  }
}
