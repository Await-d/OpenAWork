/**
 * 浏览器实时预览（P3-core）的每用户扇出中枢。
 *
 * 一个用户对应一条 live session（由 `manager.ts` 保证 max 1）。本模块把该 session 的
 * 事件转成 `BrowserLiveEnvelope` 广播给所有已挂载的 WS sink，并实现 screencast 的
 * **两段式背压**：
 *
 * 1. **对 CDP 侧立即 ack**：收到 `Page.screencastFrame` 就 `ackScreencastFrame`，让
 *    Chromium 马上开始编码下一帧（编码与客户端解码并行）。旧实现要等 controller ack
 *    才放行，导致帧率被一个完整链路往返钉死（`fps ≈ 1 / RTT`，60ms 就只剩 16fps），
 *    点击反馈也被同一环拖慢。
 * 2. **对 controller 侧限量 + 只保最新**：未 ack 的在途帧不超过
 *    `BROWSER_LIVE_HIGH_WATER_FRAMES`；等待下发的帧只保留**最新一帧**，客户端跟不上时
 *    丢掉的是过期画面而不是新画面。controller 的 ack 只用于测往返、降质与恢复信用，
 *    不再阻塞 CDP 产帧。
 *
 * watchdog 按实测 ack 往返自适应（`clamp(4 × EMA, 500ms, 配置值)`），一次丢 ack 不会
 * 再把画面冻结数秒。
 *
 * `seq` 按用户单调递增；`sink` 只需要 `{ send, isOpen }`，因此单测无需真实 socket。
 */

import {
  BROWSER_LIVE_BINARY_FRAME_KIND,
  BROWSER_LIVE_HIGH_WATER_FRAMES,
  BROWSER_LIVE_MAX_FRAME_BYTES,
} from '@openAwork/shared';
import type {
  BrowserLiveConsolePayload,
  BrowserLiveEnvelope,
  BrowserLiveErrorPayload,
  BrowserLiveFrameBinaryHeader,
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

/**
 * 自适应 watchdog 的下限与倍数（毫秒）。
 *
 * 固定 4s watchdog 的代价是「一次丢 ack 就冻结 4 秒画面」，而正常往返只有几十毫秒。
 * 这里按实测 ack 往返推算：`clamp(倍数 × EMA, 下限, 配置值)`。倍数取 4 是为了容忍
 * 一次 GC / 主线程抖动，又不至于把卡顿放大成数秒；没有样本时仍回落到配置值。
 */
const MIN_FRAME_ACK_TIMEOUT_MS = 500;
const FRAME_ACK_TIMEOUT_RTT_FACTOR = 4;

/**
 * screencast 帧的等比缩放盒（物理像素）。
 *
 * CDP 不设 `maxWidth` / `maxHeight` 时，每帧都按视口原始像素产出：大面板与高 DPR 的
 * 设备预设（手机 375×812 @2 = 750×1624）下，单帧是百万级像素的 JPEG，客户端每帧都要
 * base64 解码 + JPEG 解码 + 重绘，主线程被吃满后整个应用都会卡。取「最长边 1024」
 * 既保住预览清晰度，又把像素量压到 1280 的 64%——注意这只影响实时画面，
 * 截图（`POST /browser-live/screenshot` 与 Playwright `page.screenshot`）不受影响。
 */
export const BROWSER_LIVE_SCREENCAST_MAX_EDGE = 1024;

/**
 * screencast 帧的 JPEG 质量。
 *
 * 从 60 降到 50：每帧体积 / 编码耗时 / 客户端解码耗时同步下降，低带宽与弱 CPU
 * 环境下帧率提升明显；预览放大观看会略糊，原始分辨率请用截图（不受限帧影响）。
 */
export const BROWSER_LIVE_SCREENCAST_QUALITY = 50;

/**
 * 慢帧判定阈值（毫秒）。
 *
 * 这个值是「帧从网关发出到收到 ack」的往返时间，含客户端解码 + 绘制。超过它说明
 * 链路或客户端处理已经跟不上，继续按原质量产帧只会让画面更卡。
 *
 * **必须显著高于产帧周期**。产帧被 `BROWSER_LIVE_CDP_ACK_FLOOR_MS` 钳住之后，一次 ack
 * 往返天然包含「客户端在前面几帧后面排队」的时间：客户端只花 2ms 解码、实测 8fps
 * （≈125ms/帧）时，往返本身就会接近 125ms。若阈值取 120ms，网关会把「产帧慢」误判成
 * 「客户端消费慢」并持续降档，而降到下限后帧率并不会回升——只是画面越来越糊。
 *
 * 取 250ms（约 4fps）才代表真正的「消费端跟不上」，那时牺牲清晰度才有意义。
 */
export const BROWSER_LIVE_SLOW_FRAME_MS = 250;

/** 连续多少个慢帧才降档：偶发抖动（页面重载、主线程抢占）不该改画面质量。 */
export const BROWSER_LIVE_SLOW_FRAME_STREAK = 15;

/**
 * 两次 CDP ack 之间的最小间隔（毫秒）——产帧速率限制器。
 *
 * `Page.screencastFrameAck` 的语义是「可以编下一帧了」。收到就立即回，Chromium 的
 * 编码器会全速运转；编码与页面自身的 JS / 布局 / 绘制在同一个进程里抢 CPU，页面越重
 * 被挤压得越狠，实测表现为画面 1–3fps、点击半天才有反应。
 *
 * 取 16ms（≈60fps 上限）而不是更保守的值：限速只该拦掉「无意义的全速空转」，不该成为
 * 帧率的主要瓶颈。实测（客户端解码 2ms、单帧 10KB、带宽与 CPU 双双空闲）仍只有 8fps
 * 时，瓶颈不在链路上；此时把上限压到 25fps 只会白白损失流畅度，且会让「往返慢」的
 * 假象更容易触发降档。真正的 CPU 保护交给「交互中取消限速 + 慢帧降档」两条机制。
 *
 * 可通过 `BROWSER_LIVE_CDP_ACK_FLOOR_MS` 覆盖（0 = 不限制）。
 */
export const BROWSER_LIVE_CDP_ACK_FLOOR_MS = 16;

/**
 * 「交互中」窗口（毫秒）：最近一次用户输入之后这段时间内取消产帧限速。
 *
 * 拖动 / 输入对延迟极度敏感：限速本身要等一个间隔才放行编码，这段时间会原封不动加到
 * 「手动了、画面却没动」的感知延迟上——用户描述为「拖动明显卡顿」。而空闲时没有交互，
 * 限速的价值（把 CPU 让回给页面）才最大。
 *
 * 窗口取 250ms：覆盖一次拖动 / 连续输入的自然间隔，又不会在停手后长期占着 CPU。
 */
export const BROWSER_LIVE_INTERACTIVE_WINDOW_MS = 250;

/**
 * 快帧判定：往返低于这个值视为「链路跟得上」。
 *
 * 与慢帧阈值之间留一段中间地带（60–120ms）：不满足快帧就不回升，避免在临界点
 * 上来回调整质量。
 */
export const BROWSER_LIVE_FAST_FRAME_MS = 60;

/** 连续多少个快帧才回升一档：恢复要稳，不能一次顺滑就把质量拉满再跌回去。 */
export const BROWSER_LIVE_FAST_FRAME_STREAK = 30;

/** 两次质量调整之间的冷却期（降档 / 回升共用）。 */
export const BROWSER_LIVE_QUALITY_COOLDOWN_MS = 10_000;

/**
 * 质量步长与上下限。
 *
 * 下限从 30 提到 40：降过头会让文字边缘糊成一片，用户会在「流畅」之外再抱怨
 * 「看不清」——真到 40 还慢，问题就不在 JPEG 质量上了。
 */
export const BROWSER_LIVE_QUALITY_STEP = 15;
export const BROWSER_LIVE_QUALITY_RECOVER_STEP = 5;
export const BROWSER_LIVE_MIN_QUALITY = 40;

/**
 * 帧盒的调整步长（相对当前边长的比例）。
 *
 * 编码 / 缩放成本与像素量成正比，而像素量是**边长的平方**：缩到 85% 就少掉约 28%
 * 像素。质量见底后，这是唯一还有明显效果的杠杆——只降 JPEG 质量不降分辨率，会让链路
 * 慢的机器卡在「既慢又不够小」的档位上。
 */
export const BROWSER_LIVE_FRAME_SCALE_STEP = 0.15;

/**
 * 帧盒相对协商值的下限比例。
 *
 * 再往下就糊到看不清内容了；那时瓶颈已不在编码侧（传输 / 客户端解码 / 页面自身渲染）。
 */
export const BROWSER_LIVE_MIN_FRAME_SCALE = 0.5;

export interface BrowserLiveSink {
  send(envelope: BrowserLiveEnvelope): boolean;
  isOpen(): boolean;
  /**
   * 可选：直接发二进制帧（线路格式见 `BROWSER_LIVE_BINARY_FRAME_KIND`）。
   *
   * 返回 false 表示发送失败，调用方会回退成 JSON 信封；不实现该方法的 sink
   * （单测里的内存 sink、旧客户端）永远走 JSON。
   */
  sendBinary?(data: Uint8Array): boolean;
}

export interface BrowserLiveHubLogger {
  warn: (fields: unknown, message?: string) => void;
}

/** 一秒采样一次的帧生命周期指标；默认关闭，避免诊断本身影响实时链路。 */
export interface BrowserLiveFrameDiagnostics {
  userId: string;
  payloadChars: number;
  binaryBytes: number | null;
  produceIntervalMs: number | null;
  produceFps: number | null;
  sendMs: number;
  ackRttEmaMs: number | null;
  inflightFrames: number;
  pendingFrame: boolean;
}

/**
 * 客户端协商的 screencast 定档参数。
 *
 * 缺省字段一律回落到服务端默认（`BROWSER_LIVE_SCREENCAST_MAX_EDGE` /
 * `BROWSER_LIVE_SCREENCAST_QUALITY`），因此老客户端与不带参数的消息行为不变。
 */
export interface BrowserLiveScreencastStartOptions {
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
  format?: 'jpeg' | 'png';
}

/** 起流请求：定档参数 + 客户端是否支持二进制帧。 */
export interface BrowserLiveScreencastStartRequest extends BrowserLiveScreencastStartOptions {
  binary?: boolean;
}

export interface BrowserLiveHubOptions {
  frameAckTimeoutMs?: number;
  /** 两次 CDP ack 的最小间隔（毫秒）；0 = 不限制。缺省读环境变量。 */
  cdpAckFloorMs?: number;
  /** 是否按秒记录帧生命周期指标；缺省读取 `OPENAWORK_BROWSER_LIVE_DIAGNOSTICS=1`。 */
  traceFrames?: boolean;
  logger?: BrowserLiveHubLogger;
}

export interface BrowserLiveHub {
  subscribe(userId: string, handle: BrowserLiveHandle, sink: BrowserLiveSink): void;
  unsubscribe(userId: string, sink: BrowserLiveSink): void;
  /**
   * 标记 controller 并启动 screencast（幂等；重复调用只更新 controller）。
   *
   * `options` 由客户端按画面显示尺寸协商帧盒 / 质量；缺省字段用服务端默认。
   */
  beginScreencast(
    userId: string,
    sink: BrowserLiveSink,
    request?: BrowserLiveScreencastStartRequest,
  ): Promise<void>;
  /** 停止 screencast 并清空在途帧/队列（幂等）。 */
  endScreencast(userId: string): Promise<void>;
  /**
   * 重新武装 screencast（沿用当前定档）并**立即产出一帧**。
   *
   * 静态页（含 `about:blank`）不产生 damage 就不再推帧，客户端切标签时丢弃旧文档的
   * 帧后会永久空白——这里强制补一帧兜住。未在推流时无副作用。
   */
  refreshScreencast(userId: string): Promise<void>;
  /**
   * controller 对某帧的 ack：用于采样往返、降档/回升与恢复在途配额。
   *
   * CDP 侧的 ack 已经在下发时就发出，因此这里**不是**放行下一帧的前提；只有 controller
   * 能影响质量与配额，被动观看者的 ack 一律忽略。
   */
  ackFrame(userId: string, sink: BrowserLiveSink, frameSessionId: number): Promise<void>;
  /**
   * 记录「用户刚刚有输入」：交互窗口内取消产帧限速，优先保证跟手。
   *
   * 由输入转发路径在 `dispatchInput` 之前调用（见 `routes/browser-live.ts`）。
   */
  noteUserInput(userId: string): void;
  subscriberCount(userId: string): number;
}

/**
 * 已在路上、等待 controller ack 的一帧。
 *
 * `wireId` 是网关为线路分配的**唯一** id（CDP 自己的 `sessionId` 在同一 screencast
 * 会话内对所有帧不变，不能当线路标识）；`sentAt` 用于算 ack 往返与 watchdog 截止时间。
 */
interface InflightFrame {
  wireId: number;
  sentAt: number;
}

interface UserFanout {
  handle: BrowserLiveHandle;
  subscribers: Set<BrowserLiveSink>;
  controller: BrowserLiveSink | null;
  seq: number;
  detach: () => void;
  /** 等待 controller ack 的帧（按发出顺序），长度受高水位约束。 */
  inflight: InflightFrame[];
  /**
   * 等待下发的「最新一帧」。
   *
   * 只有一个槽位是刻意的：客户端来不及消费时，排队中的旧帧对用户没有任何价值
   * （看到的是过期画面），新帧到达即替换，保证每次下发都是当前最新的画面。
   */
  pending: BrowserLiveFramePayload | null;
  /** 单调递增的线路帧 id 计数器。 */
  frameCounter: number;
  ackTimer: ReturnType<typeof setTimeout> | null;
  screencastActive: boolean;
  /** 本次起流的定档参数（客户端协商值）；慢帧降档只改其中的 `quality`。 */
  screencast: BrowserLiveScreencastStartOptions;
  /** 当前实际生效的质量：降档 / 回升后就地收窄，重新起流时回到协商值。 */
  screencastQuality: number;
  /** 客户端协商的初始质量：回升不会越过它。 */
  baseQuality: number;
  /** 当前实际生效的帧盒：质量见底后按步长缩小（像素量是边长平方，收益最大）。 */
  screencastBox: ScreencastBox;
  /** 客户端协商的初始帧盒：回升不会越过它。 */
  baseScreencastBox: ScreencastBox;
  /** 连续慢帧 / 快帧计数，以及最近一次质量调整时刻。 */
  slowFrameStreak: number;
  fastFrameStreak: number;
  lastQualityChangeAt: number;
  /** ack 往返的指数滑动平均；没有样本时为 null（watchdog 用配置上限）。 */
  ackRttEmaMs: number | null;
  /**
   * 相邻两帧**产出**间隔的指数滑动平均；没有样本时为 null。
   *
   * 与 `ackRttEmaMs` 是两个不同的量：前者是 Chromium 多久编出一帧（编码 + 页面渲染
   * 能力），后者还要加上客户端排队与消费。降档是否值得，看的是前者——产帧已经跑到
   * 限速上限时，降像素量不会提升帧率，只会变糊。
   */
  produceIntervalEmaMs: number | null;
  /** controller 协商过二进制帧：为 true 时优先走 `sendBinary`。 */
  binaryFrames: boolean;
  dropBurstLogged: boolean;
  queueOverflowLogged: boolean;
  /**
   * 上一帧 ack 给 CDP 的时刻。
   *
   * 用来把「CDP ack」当成产帧速率限制器：Chromium 收到 ack 才编码下一帧，若 ack 之间
   * 不留间隔，编码器会全速运转与页面自身抢夺 CPU——页面越复杂，JS / 布局 / 绘制被
   * 挤压得越狠，实测会把交互压到个位数帧率。留一个最小间隔即可把产帧频率钳在
   * `1000 / BROWSER_LIVE_CDP_ACK_FLOOR_MS`，CPU 让回给页面。
   */
  lastCdpAckAt: number;
  /** 间隔内待放行的 CDP frameSessionId；协议要求每一帧都必须确认。 */
  pendingCdpAckIds: number[];
  /** 待放行 ack 的定时器。 */
  cdpAckTimer: ReturnType<typeof setTimeout> | null;
  /** 最近一次用户输入的时刻：交互窗口内取消产帧限速（见 scheduleCdpAck）。 */
  lastInputAt: number;
  /** 上一帧产出（收到 `Page.screencastFrame`）的时刻；`0` = 尚无样本。 */
  lastProducedAt: number;
  /** 上一次帧诊断日志的时刻；`0` = 尚未记录。 */
  lastDiagnosticsAt: number;
}

/** 帧盒的宽高（物理像素）。 */
interface ScreencastBox {
  width: number;
  height: number;
}

/**
 * 按比例缩放帧盒，并夹在 `[下限比例 × 协商值, 协商值]` 之间。
 *
 * 下限是相对**协商值**而非当前值：否则连续缩小时会以缩小后的值为基准，永远缩不到下限。
 * 边长取整且最小 1，避免出现 0×0 的非法帧盒。
 */
function scaleScreencastBox(
  box: ScreencastBox,
  factor: number,
  base: ScreencastBox = box,
): ScreencastBox {
  const minWidth = Math.max(1, Math.round(base.width * BROWSER_LIVE_MIN_FRAME_SCALE));
  const minHeight = Math.max(1, Math.round(base.height * BROWSER_LIVE_MIN_FRAME_SCALE));
  const nextWidth = Math.max(minWidth, Math.min(base.width, Math.round(box.width * factor)));
  const nextHeight = Math.max(minHeight, Math.min(base.height, Math.round(box.height * factor)));
  if (nextWidth === box.width && nextHeight === box.height) {
    return box;
  }
  return { width: nextWidth, height: nextHeight };
}

/** 回升时判断帧盒是否还没回到协商上限（没回到就优先补分辨率）。 */
function isBoxBelowCeiling(box: ScreencastBox, ceiling: ScreencastBox): boolean {
  return box.width < ceiling.width || box.height < ceiling.height;
}

/** ack 往返 EMA 的权重：越大越跟手，越小越抗抖动。 */
const ACK_RTT_EMA_ALPHA = 0.2;

/** 产帧间隔 EMA 的权重：比 ack 往返小，避免单帧抖动被当成「编码跟不上」。 */
const PRODUCE_INTERVAL_EMA_ALPHA = 0.15;

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

/** 读非负整数环境变量：`0` 是合法值（用于显式关闭产帧限速）。 */
function readNonNegativeIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

/**
 * 把客户端协商的定档收敛成完整参数：缺省字段回落到服务端默认。
 *
 * 归一化必须在比较「有没有变化」之前做完——客户端可能一次带 `maxWidth`（尺寸刚测出来）
 * 而另一次省略（尺寸未知时交给服务端默认），两者指向同一个实际定档，不该被当成变更
 * 而重开一次 screencast。
 */
function resolveScreencastOptions(
  request: BrowserLiveScreencastStartOptions | undefined,
): BrowserLiveScreencastStartOptions {
  const format = request?.format ?? 'jpeg';
  return {
    ...(format === 'png' ? {} : { quality: request?.quality ?? BROWSER_LIVE_SCREENCAST_QUALITY }),
    maxWidth: request?.maxWidth ?? BROWSER_LIVE_SCREENCAST_MAX_EDGE,
    maxHeight: request?.maxHeight ?? BROWSER_LIVE_SCREENCAST_MAX_EDGE,
    ...(format === 'png' ? { format: 'png' as const } : {}),
  };
}

/** 定档是否真的变了（三项逐项比较；窗口内降档改的是 `screencast` 自身）。 */
function hasScreencastOptionsChanged(
  current: BrowserLiveScreencastStartOptions,
  next: BrowserLiveScreencastStartOptions,
): boolean {
  return (
    current.quality !== next.quality ||
    current.maxWidth !== next.maxWidth ||
    current.maxHeight !== next.maxHeight ||
    current.format !== next.format
  );
}

function toFramePayload(
  event: Extract<BrowserLiveEventLike, { type: 'screencastFrame' }>,
  wireFrameId: number,
  format: 'jpeg' | 'png',
): BrowserLiveFramePayload {
  return {
    mimeType: format === 'png' ? 'image/png' : 'image/jpeg',
    data: event.data,
    deviceWidth: event.deviceWidth,
    deviceHeight: event.deviceHeight,
    offsetTop: event.offsetTop,
    pageScaleFactor: event.pageScaleFactor,
    scrollOffsetX: event.scrollOffsetX,
    scrollOffsetY: event.scrollOffsetY,
    frameSessionId: wireFrameId,
    // 页面代次透传给客户端：它据此丢弃「切换前旧页面」的迟到帧。
    ...(typeof event.generation === 'number' ? { generation: event.generation } : {}),
  };
}

/**
 * 把一帧编码成二进制线路格式（格式见 shared 的 `BROWSER_LIVE_BINARY_FRAME_KIND`）。
 *
 * base64 → 字节在网关侧只做一次（`Buffer.from(data, 'base64')` 走原生实现），换来
 * 线路上少 33% 体积，以及客户端完全不用 `atob` + 逐字节搬运——那一步正是实时画面
 * 掉帧、点击反馈变慢时最容易被忽略的主线程成本。
 */
function encodeBinaryFrame(payload: BrowserLiveFramePayload, seq: number, ts: number): Uint8Array {
  const header: BrowserLiveFrameBinaryHeader = {
    seq,
    ts,
    mimeType: payload.mimeType,
    deviceWidth: payload.deviceWidth,
    deviceHeight: payload.deviceHeight,
    offsetTop: payload.offsetTop,
    pageScaleFactor: payload.pageScaleFactor,
    scrollOffsetX: payload.scrollOffsetX,
    scrollOffsetY: payload.scrollOffsetY,
    frameSessionId: payload.frameSessionId,
    // 代次必须一起进二进制头：客户端协商二进制帧时（能离线程解码，属常态路径）
    // 只解析这个头，漏掉就等于代次过滤在快路径上完全失效。
    ...(typeof payload.generation === 'number' ? { generation: payload.generation } : {}),
  };
  const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
  const imageBytes = Buffer.from(payload.data, 'base64');
  const frame = Buffer.allocUnsafe(5 + headerBytes.length + imageBytes.length);
  frame[0] = BROWSER_LIVE_BINARY_FRAME_KIND;
  frame.writeUInt32LE(headerBytes.length, 1);
  headerBytes.copy(frame, 5);
  imageBytes.copy(frame, 5 + headerBytes.length);
  return frame;
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
    // 网络请求的页面代次：归并到正确的标签，而不是当前激活标签。
    ...(typeof event.generation === 'number' ? { generation: event.generation } : {}),
  };
}

class BrowserLiveHubImpl implements BrowserLiveHub {
  private readonly users = new Map<string, UserFanout>();
  private readonly frameAckTimeoutMs: number;
  /** 两次 CDP ack 的最小间隔；0 = 不限制产帧速率。 */
  private readonly cdpAckFloorMs: number;
  private readonly traceFrames: boolean;
  private readonly logger: BrowserLiveHubLogger;

  constructor(options: BrowserLiveHubOptions = {}) {
    this.frameAckTimeoutMs =
      options.frameAckTimeoutMs ??
      readPositiveIntEnv('BROWSER_LIVE_FRAME_ACK_TIMEOUT_MS', DEFAULT_FRAME_ACK_TIMEOUT_MS);
    // 允许显式传 0 关闭限速，因此不走 `readPositiveIntEnv`（它会把 0 当成非法）。
    this.cdpAckFloorMs =
      options.cdpAckFloorMs ??
      readNonNegativeIntEnv('BROWSER_LIVE_CDP_ACK_FLOOR_MS', BROWSER_LIVE_CDP_ACK_FLOOR_MS);
    this.traceFrames =
      options.traceFrames ?? process.env['OPENAWORK_BROWSER_LIVE_DIAGNOSTICS'] === '1';
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
        inflight: [],
        pending: null,
        frameCounter: 0,
        ackTimer: null,
        screencastActive: false,
        screencast: {},
        screencastQuality: BROWSER_LIVE_SCREENCAST_QUALITY,
        baseQuality: BROWSER_LIVE_SCREENCAST_QUALITY,
        // 帧盒的真实值在起流时按客户端协商参数落定（见 applyScreencastOptions）。
        screencastBox: {
          width: BROWSER_LIVE_SCREENCAST_MAX_EDGE,
          height: BROWSER_LIVE_SCREENCAST_MAX_EDGE,
        },
        baseScreencastBox: {
          width: BROWSER_LIVE_SCREENCAST_MAX_EDGE,
          height: BROWSER_LIVE_SCREENCAST_MAX_EDGE,
        },
        slowFrameStreak: 0,
        fastFrameStreak: 0,
        lastQualityChangeAt: 0,
        ackRttEmaMs: null,
        produceIntervalEmaMs: null,
        binaryFrames: false,
        dropBurstLogged: false,
        queueOverflowLogged: false,
        lastCdpAckAt: 0,
        pendingCdpAckIds: [],
        cdpAckTimer: null,
        lastInputAt: 0,
        lastProducedAt: 0,
        lastDiagnosticsAt: 0,
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
      fanout.inflight.length = 0;
      fanout.pending = null;
      this.users.delete(userId);
      if (fanout.screencastActive) {
        void this.stopScreencast(fanout);
      }
    }
  }

  async beginScreencast(
    userId: string,
    sink: BrowserLiveSink,
    request?: BrowserLiveScreencastStartRequest,
  ): Promise<void> {
    const fanout = this.users.get(userId);
    if (!fanout) {
      return;
    }
    fanout.controller = sink;
    // 二进制帧是传输层能力，与 CDP 的定档参数无关：只记录，不参与「是否重开」判定。
    fanout.binaryFrames = request?.binary === true;
    const next = resolveScreencastOptions(request);

    if (fanout.screencastActive) {
      // 已在推流时，只有「定档完全没变」才早退。
      //
      // 旧实现无条件早退，于是推流期间的 `screencast.start` 被整条吞掉：前端切画质
      // 档位只做「解除武装 → 重发 start」，结果「流畅 / 均衡 / 清晰」在画面跑着的
      // 时候完全不生效，用户必须收起面板或断线重连才看得到变化——他要降档却降不下
      // 来，自然判定「又卡又糊、没救」。
      if (!hasScreencastOptionsChanged(fanout.screencast, next)) {
        return;
      }
      this.applyScreencastOptions(fanout, next);
      // `Page.startScreencast` 幂等：重发即按新定档立即产出一帧，不必先停流。
      await fanout.handle.session.startScreencast(fanout.screencast);
      return;
    }

    // 起流即定档：帧尺寸 / 质量上限在这里设定，之后的 rearm 与设备切换收敛
    // （`ScreencastConvergence` 按同一盒子推算期望位图尺寸）都沿用这一份。
    this.applyScreencastOptions(fanout, next);
    // 先置位再发指令：`Page.startScreencast` 会立即按当前视口产出首帧，而它的 CDP 事件
    // 可能先于本次 await 的 resolve 到达。若那时 active 还是 false，首帧会被
    // `handleScreencastFrame` 当成「停流后的残留帧」丢掉——画面要等下一次 damage 才出现，
    // 静态页（`about:blank`）甚至永远空白。
    fanout.screencastActive = true;
    try {
      await fanout.handle.session.startScreencast(fanout.screencast);
    } catch (error) {
      // 起流失败必须回滚置位，否则会话停在「声称在推流、实际没有流」的状态，
      // 后续 `screencast.stop` 还会去停一条不存在的流。
      fanout.screencastActive = false;
      throw error;
    }
  }

  async endScreencast(userId: string): Promise<void> {
    const fanout = this.users.get(userId);
    if (!fanout) {
      return;
    }
    await this.stopScreencast(fanout);
  }

  async refreshScreencast(userId: string): Promise<void> {
    const fanout = this.users.get(userId);
    if (!fanout || !fanout.screencastActive) {
      return;
    }
    // 重发 `Page.startScreencast`（幂等）会立刻按当前视口推一帧；参数沿用起流定档，
    // 不改画质、不重置慢帧统计。
    try {
      await fanout.handle.session.startScreencast(fanout.screencast);
    } catch (error) {
      this.logger.warn({ err: error, userId }, 'browser live failed to refresh screencast');
    }
  }

  async ackFrame(userId: string, sink: BrowserLiveSink, frameSessionId: number): Promise<void> {
    const fanout = this.users.get(userId);
    if (!fanout) {
      return;
    }
    // 只有 controller 的 ack 才影响质量与配额；被动观看者的 ack 一律忽略。
    if (fanout.controller !== sink) {
      return;
    }
    const index = fanout.inflight.findIndex((frame) => frame.wireId === frameSessionId);
    if (index < 0) {
      // 过期 / 重复 ack（watchdog 已兜底放行过这一帧）：只丢弃，不动其余在途帧。
      return;
    }

    const acked = fanout.inflight[index];
    fanout.inflight.splice(index, 1);
    if (acked !== undefined) {
      this.noteAckRoundTrip(userId, fanout, Date.now() - acked.sentAt);
    }
    // `armAckTimer` 自己会先清掉旧 timer，这里不必再清一次。
    this.armAckTimer(userId, fanout);
    this.pumpFrames(userId, fanout);
  }

  /**
   * 记录一次 ack 往返：更新自适应 watchdog 的 EMA，再交给「慢帧降档 / 快帧回升」。
   *
   * 两个消费者共用同一个样本，口径却不同：watchdog 要「刚刚的健康水平」，所以跟手
   * （α = 0.2）；降质判定要「连续多帧都慢」，仍走计数窗口，不被单帧抖动带偏。
   */
  private noteAckRoundTrip(userId: string, fanout: UserFanout, elapsedMs: number): void {
    const previous = fanout.ackRttEmaMs;
    fanout.ackRttEmaMs =
      previous === null ? elapsedMs : previous + ACK_RTT_EMA_ALPHA * (elapsedMs - previous);
    this.noteFrameLatency(userId, fanout, elapsedMs);
  }

  /** 把定档参数落到 fanout，并重置慢帧 / 快帧窗口与冷却期（重新定档是新的起点）。 */
  private applyScreencastOptions(
    fanout: UserFanout,
    options: BrowserLiveScreencastStartOptions,
  ): void {
    fanout.screencast = { ...options };
    fanout.screencastQuality = options.quality ?? BROWSER_LIVE_SCREENCAST_QUALITY;
    fanout.baseQuality = fanout.screencastQuality;
    // 帧盒定档：这次协商值就是「可回退的上限」，运行中降档只会往下缩。
    const box: ScreencastBox = {
      width: options.maxWidth ?? BROWSER_LIVE_SCREENCAST_MAX_EDGE,
      height: options.maxHeight ?? BROWSER_LIVE_SCREENCAST_MAX_EDGE,
    };
    fanout.screencastBox = box;
    fanout.baseScreencastBox = box;
    fanout.slowFrameStreak = 0;
    fanout.fastFrameStreak = 0;
    // 重新定档是一次新的开始：日志降噪标记复位，下一轮追赶能重新报一次。
    fanout.queueOverflowLogged = false;
    fanout.dropBurstLogged = false;
    // 起流即视为「冷却已过」：第一次慢帧窗口不必再等一个冷却期才生效。
    fanout.lastQualityChangeAt = Date.now() - BROWSER_LIVE_QUALITY_COOLDOWN_MS;
  }

  /**
   * 采样一帧的 ack 往返，慢了降档、稳了回升。
   *
   * 只降不升会让「一开始卡了几秒」的会话永久停在糊画面上；回升有独立的快帧窗口
   * 与冷却期，且不会越过客户端协商的初始质量，所以来回震荡被压得比较死。
   *
   * **降档前提是「降了有用」**：真正决定画面是否流畅的是产帧速率，而不是 ack 往返。
   * 产帧被 `BROWSER_LIVE_CDP_ACK_FLOOR_MS` 钳住后，往返里天然含排队时间——客户端明明
   * 2ms 就解完一帧、帧率却只有 8fps 时，往返同样会超过任何合理阈值。这种情形下降档
   * 只是让画面更糊、帧率不变（瓶颈在 Chromium 编码 / 页面自身渲染，不在像素量）。
   *
   * 因此这里额外要求「产帧间隔也确实慢」才降档；产帧快而消费慢时保持当前档位，
   * 由在途配额与丢旧帧去兜底——那才是消费端慢的正确处理方式。
   */
  private noteFrameLatency(userId: string, fanout: UserFanout, elapsedMs: number): void {
    if (elapsedMs <= BROWSER_LIVE_FAST_FRAME_MS) {
      fanout.slowFrameStreak = 0;
      fanout.fastFrameStreak += 1;
      if (fanout.fastFrameStreak >= BROWSER_LIVE_FAST_FRAME_STREAK) {
        fanout.fastFrameStreak = 0;
        this.adjustScreencastQuality(userId, fanout, BROWSER_LIVE_QUALITY_RECOVER_STEP);
      }
      return;
    }

    fanout.fastFrameStreak = 0;
    if (elapsedMs <= BROWSER_LIVE_SLOW_FRAME_MS) {
      // 中间地带：既不累计慢帧也不累计快帧，避免临界值附近来回调整。
      fanout.slowFrameStreak = 0;
      return;
    }

    // 往返慢，但产帧本身不慢 → 瓶颈在客户端排队 / 消费，不是像素量。
    // 此时降档不会提升帧率，只会让画面更糊，因此不动质量。
    if (!this.isProduceRateLagging(fanout)) {
      fanout.slowFrameStreak = 0;
      return;
    }

    fanout.slowFrameStreak += 1;
    if (fanout.slowFrameStreak < BROWSER_LIVE_SLOW_FRAME_STREAK) {
      return;
    }
    fanout.slowFrameStreak = 0;
    this.adjustScreencastQuality(userId, fanout, -BROWSER_LIVE_QUALITY_STEP);
  }

  /**
   * 产帧速率是否真的跟不上（即「降像素量有可能提升帧率」）。
   *
   * 判据要看**页面上确实有持续 damage** 时的产帧速率。静止页面的产帧间隔天然很长
   * （没有 damage 就不产帧），那不是「编码跟不上」，降档也换不来帧率。
   *
   * 因此这里不直接比较间隔绝对值，而是判断「产帧间隔是否显著大于 ack 限速周期」并且
   * 「帧是连续产出的」：
   *
   * - 限速开启时，若产帧间隔已接近限速周期（`≤ 1.5 ×`），说明编码跟得上，瓶颈在别处；
   * - 间隔远大于限速周期，说明 Chromium 编码 / 页面渲染确实吃力，降档才有可能有效。
   *
   * 没有产出间隔样本（刚起流）时返回 true：先给一次降档机会，再靠回升窗口纠正。
   */
  private isProduceRateLagging(fanout: UserFanout): boolean {
    const interval = fanout.produceIntervalEmaMs;
    if (interval === null || !Number.isFinite(interval) || interval <= 0) {
      return true;
    }
    // 限速已关闭：没有任何人为节拍，任何慢于慢帧阈值的产出间隔都是真实吃力。
    if (this.cdpAckFloorMs <= 0) {
      return interval > BROWSER_LIVE_SLOW_FRAME_MS;
    }
    // 限速开启：产出间隔明显超过限速周期，说明「放行了却编不出来」。
    return interval > this.cdpAckFloorMs * 1.5;
  }

  /**
   * 按步长调整画质并重开 screencast；受冷却期与上下限约束。
   *
   * 两级杠杆，先质量后分辨率：
   * 1. **降 JPEG 质量**：直接减少每帧字节数（传输 / 解码变快），对编码耗时影响较小；
   * 2. **质量见底后降帧盒**：编码 / 缩放成本与像素量成正比，而像素量是**边长的平方**
   *    ——帧盒缩到 70% 就是砍掉一半像素，这是质量见底后唯一还有明显效果的手段。
   *    只降质量不降分辨率会让链路慢的机器卡在「既慢又不够小」的档位上。
   *
   * 帧盒下限 `BROWSER_LIVE_MIN_FRAME_SCALE`（相对协商值的比例）保证不会糊到不可用；
   * 回升时优先把帧盒抬回去，再抬质量。
   */
  private adjustScreencastQuality(userId: string, fanout: UserFanout, delta: number): void {
    // PNG 是无损格式，不接受 JPEG quality；仅在 JPEG 模式下做自适应质量调整。
    // 无损档位仍可通过帧盒背压保护稳定性，但不会因为无意义的 quality 变化而重启流。
    if (fanout.screencast.format === 'png') {
      return;
    }
    const now = Date.now();
    if (now - fanout.lastQualityChangeAt < BROWSER_LIVE_QUALITY_COOLDOWN_MS) {
      return;
    }

    const wantsDown = delta < 0;
    let nextQuality = fanout.screencastQuality;
    let nextBox = fanout.screencastBox;

    if (wantsDown) {
      // 先降质量；质量已经见底才动帧盒。
      if (nextQuality > BROWSER_LIVE_MIN_QUALITY) {
        nextQuality = Math.max(BROWSER_LIVE_MIN_QUALITY, nextQuality + delta);
      } else {
        nextBox = scaleScreencastBox(
          nextBox,
          1 - BROWSER_LIVE_FRAME_SCALE_STEP,
          fanout.baseScreencastBox,
        );
      }
    } else {
      // 回升顺序反过来：先把分辨率补回去（清晰度收益更明显），再升质量。
      const restoredBox = scaleScreencastBox(
        nextBox,
        1 + BROWSER_LIVE_FRAME_SCALE_STEP,
        fanout.baseScreencastBox,
      );
      if (restoredBox !== nextBox && isBoxBelowCeiling(restoredBox, fanout.baseScreencastBox)) {
        nextBox = restoredBox;
      } else {
        nextQuality = Math.min(fanout.baseQuality, nextQuality + delta);
      }
    }

    const boxChanged = nextBox !== fanout.screencastBox;
    if (nextQuality === fanout.screencastQuality && !boxChanged) {
      return;
    }

    fanout.lastQualityChangeAt = now;
    fanout.screencastQuality = nextQuality;
    fanout.screencastBox = nextBox;
    fanout.screencast = {
      ...fanout.screencast,
      quality: nextQuality,
      maxWidth: nextBox.width,
      maxHeight: nextBox.height,
    };
    // `Page.startScreencast` 幂等：重发即按新定档立即产出一帧，不需要先停流。
    void fanout.handle.session.startScreencast(fanout.screencast).catch((error: unknown) => {
      this.logger.warn(
        { err: error, userId, quality: nextQuality, box: nextBox },
        'browser live failed to adjust screencast quality',
      );
    });
    this.logger.warn(
      { userId, quality: nextQuality, box: nextBox, delta },
      'browser live screencast quality adjusted',
    );
  }

  noteUserInput(userId: string): void {
    const fanout = this.users.get(userId);
    if (!fanout) {
      return;
    }
    fanout.lastInputAt = Date.now();
    // 交互一开始就把挂起的限速 ack 立即放行：用户已经动了，画面不该再等一个间隔。
    if (fanout.cdpAckTimer !== null) {
      clearTimeout(fanout.cdpAckTimer);
      fanout.cdpAckTimer = null;
    }
    const pendingIds = fanout.pendingCdpAckIds.splice(0, fanout.pendingCdpAckIds.length);
    if (pendingIds.length > 0) {
      fanout.lastCdpAckAt = Date.now();
      for (const pendingId of pendingIds) {
        void this.ackSessionFrame(fanout, pendingId);
      }
    }
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
          // 日志的页面代次：客户端据此把它记到「正确的标签」而不是当前激活标签。
          ...(typeof event.generation === 'number' ? { generation: event.generation } : {}),
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
          // 精确代次：客户端据此设置「可接受的最小代次」，避免用「上一代 + 1」猜测。
          ...(typeof event.generation === 'number' ? { generation: event.generation } : {}),
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
          // 异常同样带页面代次：避免旧页面的错误记到新标签上。
          ...(typeof event.generation === 'number' ? { generation: event.generation } : {}),
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
    // **CDP ack 是产帧速率限制器**，不能「收到就立刻回」。
    //
    // `Page.screencastFrameAck` 的语义是「你可以编下一帧了」：回得越快，Chromium 的
    // 编码器越快进入全速循环。编码本身要抢 CPU，而页面自己的 JS / 布局 / 绘制也在
    // 同一个进程里——页面越重，被挤压得越明显，实测表现就是「画面 1–3fps、点一下
    // 半天才有反应」。这正是此前只在客户端做 ack 节流却始终没解决的原因：真正把
    // CPU 吃满的是网关侧**立即 ack** 带来的全速编码。
    //
    // 这里保留一个最小间隔，把产帧频率钳在 `1000 / BROWSER_LIVE_CDP_ACK_FLOOR_MS`，
    // 把 CPU 让回给页面。间隔内到达的帧先记账（frameSessionId），到点逐帧补 ack；
    // CDP 要求每个 sessionId 都确认，不能用「只确认最新一帧」替代协议语义。
    //
    // 这一句必须在下面的任何早退之前：`Page.screencastFrame` 是「一帧一确认」的协议，
    // 漏掉任何一帧的 ack，Chromium 就再也不会产出下一帧——整条画面静默冻结。
    // 尤其是起流瞬间，首帧可能先于 `startScreencast` 的响应到达，那时
    // `screencastActive` 还是 false，绝不能因此跳过 ack。
    void this.scheduleCdpAck(fanout, event.frameSessionId);

    // 已停流却仍有在途帧（stop 与最后几帧赛跑）：ack 已经还了，但不要再下发过期画面。
    if (!fanout.screencastActive) {
      return;
    }

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
      return;
    }

    fanout.dropBurstLogged = false;

    // 记录**产帧**间隔（与 ack 往返分开）：降档是否值得取决于 Chromium 多久编出一帧，
    // 而不是「网关发出→客户端 ack」这段含排队的时间。见 `isProduceRateLagging`。
    const producedAt = Date.now();
    const previousProducedAt = fanout.lastProducedAt;
    fanout.lastProducedAt = producedAt;
    if (previousProducedAt > 0) {
      const interval = producedAt - previousProducedAt;
      const previous = fanout.produceIntervalEmaMs;
      fanout.produceIntervalEmaMs =
        previous === null
          ? interval
          : previous + PRODUCE_INTERVAL_EMA_ALPHA * (interval - previous);
    }

    if (fanout.pending !== null && !fanout.queueOverflowLogged) {
      // 上一帧还没下发就被新帧顶掉：客户端正在追赶，属于正常的「只保最新」。
      fanout.queueOverflowLogged = true;
      this.logger.warn(
        { userId, inflight: fanout.inflight.length },
        'browser live frame superseded before delivery',
      );
    }

    // 只保留最新一帧：旧帧对用户没有价值（看到的是过期画面），新帧直接顶掉它。
    fanout.frameCounter += 1;
    fanout.pending = toFramePayload(event, fanout.frameCounter, fanout.screencast.format ?? 'jpeg');
    this.pumpFrames(userId, fanout);
  }

  /**
   * 尽量把「最新一帧」下发出去。
   *
   * 同时受两个约束：未 ack 的在途帧不超过高水位（保证客户端不是在给过时的画面排队），
   * 且每次只发 `pending` 里的那一帧——它永远是最新的。
   */
  private pumpFrames(userId: string, fanout: UserFanout): void {
    if (!fanout.screencastActive) {
      return;
    }
    if (fanout.subscribers.size === 0) {
      return;
    }
    if (fanout.inflight.length >= BROWSER_LIVE_HIGH_WATER_FRAMES) {
      return;
    }

    const next = fanout.pending;
    if (next === null) {
      return;
    }
    fanout.pending = null;

    fanout.inflight.push({ wireId: next.frameSessionId, sentAt: Date.now() });
    const publishResult = this.publishFrame(userId, fanout, next);
    this.maybeTraceFrameDiagnostics(userId, fanout, next, publishResult);
    this.armAckTimer(userId, fanout);
  }

  /**
   * 为最早的未 ack 帧安排 watchdog。
   *
   * 单一 timer 挂在队首：任何一次 ack / 超时都会重新安排，保证「最早那一帧的截止时间」
   * 始终有效，不需要每帧一个定时器。
   */
  private armAckTimer(userId: string, fanout: UserFanout): void {
    this.clearAckTimer(fanout);
    const head = fanout.inflight[0];
    if (head === undefined) {
      return;
    }

    const now = Date.now();
    const deadline = head.sentAt + this.resolveAckTimeoutMs(fanout);
    const timer = setTimeout(
      () => {
        void this.expireInflight(userId, fanout, head.wireId);
      },
      Math.max(deadline - now, 0),
    );
    const unrefable = timer as ReturnType<typeof setTimeout> & { unref?: () => void };
    unrefable.unref?.();
    fanout.ackTimer = timer;
  }

  /**
   * 本轮 watchdog 的耐心值：随实测往返收紧，且永不超过配置上限。
   *
   * 固定 4s 的代价是「丢一次 ack 就冻结 4 秒」，而正常往返只有几十毫秒；收紧后同样
   * 丢 ack 只损失几百毫秒。没有样本时（刚起流 / 一直超时）仍用配置值，避免误伤
   * 首帧与后台标签这类长间隔场景。
   */
  private resolveAckTimeoutMs(fanout: UserFanout): number {
    const rtt = fanout.ackRttEmaMs;
    if (rtt === null || !Number.isFinite(rtt) || rtt <= 0) {
      return this.frameAckTimeoutMs;
    }
    return Math.min(
      this.frameAckTimeoutMs,
      Math.max(MIN_FRAME_ACK_TIMEOUT_MS, Math.round(rtt * FRAME_ACK_TIMEOUT_RTT_FACTOR)),
    );
  }

  /**
   * 某一帧等太久仍未 ack：释放它的配额并继续派发，避免 controller 卡死整条链路。
   *
   * 超时不喂慢帧样本——页面隐藏 / 后台标签本就可能长时间不 ack，据此降质会误伤；
   * CDP 侧早已放行，所以这里只是本地配额与 timer 的清理。
   */
  private async expireInflight(userId: string, fanout: UserFanout, wireId: number): Promise<void> {
    const index = fanout.inflight.findIndex((frame) => frame.wireId === wireId);
    if (index < 0) {
      return;
    }
    fanout.inflight.splice(index, 1);
    // `armAckTimer` 自己会先清掉旧 timer，这里不必再清一次。
    this.armAckTimer(userId, fanout);
    this.pumpFrames(userId, fanout);
  }

  /**
   * 按最小间隔放行 CDP 产帧（见 `handleScreencastFrame` 的说明）。
   *
   * 间隔内到达的帧进入待确认队列。`Page.screencastFrameAck` 是逐帧协议，不能只确认
   * 最新一帧，否则旧 sessionId 可能永久占住 Chromium 的 screencast credit。
   *
   * 定时器 `unref()`：网关空闲时不该因为它无法退出。
   */
  private scheduleCdpAck(fanout: UserFanout, frameSessionId: number): void {
    // 停流与 CDP 事件是并发的：stopScreencast 可能先把流标记为 inactive，
    // 随后才收到已经在 Chromium 事件队列里的最后一帧。该帧仍然属于已收到的
    // `Page.screencastFrame`，必须确认；否则 Chromium 会一直持有这份 credit，
    // 下一次起流就可能被旧帧永久卡住。停流期间不再做节流，直接回 ack。
    if (!fanout.screencastActive) {
      void this.ackSessionFrame(fanout, frameSessionId);
      return;
    }
    const floorMs = this.cdpAckFloorMs;
    if (floorMs <= 0) {
      void this.ackSessionFrame(fanout, frameSessionId);
      return;
    }
    const now = Date.now();
    // 交互中不做限速：限速的等待会原封不动加到「手动了、画面还没动」的感知延迟上，
    // 也就是用户说的「拖动明显卡顿」。空闲时限速才有价值（把 CPU 让回给页面）。
    if (now - fanout.lastInputAt < BROWSER_LIVE_INTERACTIVE_WINDOW_MS) {
      // 已经挂起的定时器要撤掉：交互中每一帧都立即放行。
      if (fanout.cdpAckTimer !== null) {
        clearTimeout(fanout.cdpAckTimer);
        fanout.cdpAckTimer = null;
      }
      const pendingIds = fanout.pendingCdpAckIds.splice(0, fanout.pendingCdpAckIds.length);
      fanout.lastCdpAckAt = now;
      void this.ackSessionFrame(fanout, frameSessionId);
      for (const pendingId of pendingIds) {
        void this.ackSessionFrame(fanout, pendingId);
      }
      return;
    }
    const wait = floorMs - (now - fanout.lastCdpAckAt);
    if (wait <= 0) {
      fanout.lastCdpAckAt = now;
      const pendingIds = fanout.pendingCdpAckIds.splice(0, fanout.pendingCdpAckIds.length);
      void this.ackSessionFrame(fanout, frameSessionId);
      for (const pendingId of pendingIds) {
        void this.ackSessionFrame(fanout, pendingId);
      }
      return;
    }
    fanout.pendingCdpAckIds.push(frameSessionId);
    if (fanout.cdpAckTimer !== null) {
      return;
    }
    const timer = setTimeout(() => {
      fanout.cdpAckTimer = null;
      const pendingIds = fanout.pendingCdpAckIds.splice(0, fanout.pendingCdpAckIds.length);
      if (pendingIds.length === 0) {
        return;
      }
      fanout.lastCdpAckAt = Date.now();
      for (const pendingId of pendingIds) {
        void this.ackSessionFrame(fanout, pendingId);
      }
    }, wait);
    const unrefable = timer as ReturnType<typeof setTimeout> & { unref?: () => void };
    unrefable.unref?.();
    fanout.cdpAckTimer = timer;
  }

  /**
   * 清理 CDP ack 定时器并确认已经收到的所有帧。
   *
   * `Page.screencastFrameAck` 是逐帧协议；「停流」只会阻止后续产帧，不会撤销已经
   * 到达网关的事件。因此不能简单丢弃 pending sessionId，否则 stop → start 的窗口
   * 会把旧 credit 泄漏给下一条 screencast。
   */
  private clearCdpAckState(fanout: UserFanout): void {
    if (fanout.cdpAckTimer !== null) {
      clearTimeout(fanout.cdpAckTimer);
      fanout.cdpAckTimer = null;
    }
    const pendingIds = fanout.pendingCdpAckIds.splice(0, fanout.pendingCdpAckIds.length);
    fanout.lastCdpAckAt = 0;
    for (const pendingId of pendingIds) {
      void this.ackSessionFrame(fanout, pendingId);
    }
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
    // 待放行的 CDP ack 必须一起清掉：向已停止的 screencast 补 ack 会干扰下次起流的
    // 帧序号；同时重置速率基准，续流后第一帧立即放行（不必等一个间隔）。
    this.clearCdpAckState(fanout);
    fanout.inflight.length = 0;
    fanout.pending = null;
    fanout.slowFrameStreak = 0;
    fanout.fastFrameStreak = 0;
    // 停流后往返样本失效：下次起流重新采样，避免拿旧链路的 EMA 收紧 watchdog。
    fanout.ackRttEmaMs = null;

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

  /**
   * 下发一帧：支持二进制的 sink 走原始字节，其余回退 JSON 信封。
   *
   * 二进制只在 controller 主动协商后启用，所以同一扇出里同时存在两种 sink 是常态
   * （例如另一个只读客户端）。编码结果按帧复用，避免为每个 sink 各解一次 base64。
   */
  private publishFrame(
    _userId: string,
    fanout: UserFanout,
    payload: BrowserLiveFramePayload,
  ): { sendMs: number; binaryBytes: number | null } {
    const startedAt = Date.now();
    fanout.seq += 1;
    const envelope: BrowserLiveEnvelope = {
      ch: 'frame',
      seq: fanout.seq,
      ts: Date.now(),
      payload,
    };
    let binary: Uint8Array | null = null;
    for (const sink of fanout.subscribers) {
      if (!sink.isOpen()) {
        continue;
      }
      if (fanout.binaryFrames && sink.sendBinary) {
        binary ??= encodeBinaryFrame(payload, envelope.seq, envelope.ts);
        if (sink.sendBinary(binary)) {
          continue;
        }
      }
      sink.send(envelope);
    }
    return { sendMs: Math.max(0, Date.now() - startedAt), binaryBytes: binary?.byteLength ?? null };
  }

  private maybeTraceFrameDiagnostics(
    userId: string,
    fanout: UserFanout,
    payload: BrowserLiveFramePayload,
    publishResult: { sendMs: number; binaryBytes: number | null },
  ): void {
    if (!this.traceFrames) {
      return;
    }
    const now = Date.now();
    if (fanout.lastDiagnosticsAt !== 0 && now - fanout.lastDiagnosticsAt < 1_000) {
      return;
    }
    fanout.lastDiagnosticsAt = now;
    const produceIntervalMs = fanout.produceIntervalEmaMs;
    const diagnostics: BrowserLiveFrameDiagnostics = {
      userId,
      payloadChars: payload.data.length,
      binaryBytes: publishResult.binaryBytes,
      produceIntervalMs,
      produceFps:
        produceIntervalMs !== null && produceIntervalMs > 0
          ? Number((1000 / produceIntervalMs).toFixed(1))
          : null,
      sendMs: publishResult.sendMs,
      ackRttEmaMs: fanout.ackRttEmaMs,
      inflightFrames: fanout.inflight.length,
      pendingFrame: fanout.pending !== null,
    };
    this.logger.warn(diagnostics, 'browser live frame diagnostics');
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
