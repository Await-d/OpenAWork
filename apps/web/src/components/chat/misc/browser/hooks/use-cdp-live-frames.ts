/**
 * CDP 实时预览的「画面面」：收帧 → 离主线程解码 → 画进 `<canvas>` → 回 ack。
 *
 * 三件事必须一起做，拆开就会坏：
 * 1. **消费完必须回 ack**：网关对 CDP 侧是收到帧就立即放行（§5.3），ack 在这里只用于
 *    测往返、降质与回收在途配额——但漏掉一条仍会让那一帧的配额白占，直到 watchdog
 *    才回收。因此画出或解码失败都必须回；
 * 2. **重活不进 React**：帧是百 KB 级 base64，一帧一次 `setState` 会把渲染、大字符串
 *    拷贝与 GC 压力全摊在主线程。这里只把「元数据尺寸」「是否已有画面」两份轻量状态
 *    交给 React，帧数据本身留在 ref 里；
 * 3. **异步解码要防倒灌**：解码是异步的，用代次计数丢弃过期结果，卸载后也不再往画布上画。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { BrowserLiveBinaryFramePayload, BrowserLiveFramePayload } from '@openAwork/shared';

import { decodeFrame, decodeFrameFromBytes, type DecodedFrame } from '../frame-decode.js';
import type { BrowserLiveSession } from './use-browser-live-session.js';

/**
 * ack 不做任何「最小间隔」节流：处理完（或解码失败）**立即**回。
 *
 * 三点理由：
 * 1. ack 决定「在途配额」何时归还：网关未 ack 的在途帧达到高水位就暂停向本端下发，
 *    延迟 ack 等于直接压低自己的帧率；
 * 2. 定时器版本有一个隐蔽缺陷：`ackTimer` 挂起期间到达的 ack 会被直接丢弃，那一帧
 *    的配额只能等 watchdog 才释放；
 * 3. ack 往返同时是降质判据与 watchdog 的估计输入，人为抖动会把它带偏。
 *
 * 防炸机不靠节流：解码慢时 ack 自然变慢（帧率 = 消费能力）；网关侧还有自适应
 * watchdog 与「只保最新」的待发槽兜底。
 */

/** 帧率采样的统计窗口（毫秒）：窗口内累加帧数，到点换算一次并刷新状态。 */
export const FPS_SAMPLE_WINDOW_MS = 1000;

/** 一个采样窗口的结算（纯函数，便于直接钉住换算口径）。 */
export function computeFrameStats(input: {
  frames: number;
  elapsedMs: number;
  lastFrameChars: number;
  lastProcessingMs: number;
  lastQueueMs?: number;
  lastDecodeMs?: number;
  lastPaintMs?: number;
}): CdpLiveFrameStats {
  return {
    fps: input.elapsedMs > 0 ? Math.round((input.frames * 1000) / input.elapsedMs) : 0,
    frameChars: input.lastFrameChars,
    processingMs: Math.round(input.lastProcessingMs),
    queueMs: Math.round(input.lastQueueMs ?? 0),
    decodeMs: Math.round(input.lastDecodeMs ?? 0),
    paintMs: Math.round(input.lastPaintMs ?? 0),
  };
}

/** 帧元数据里与布局 / 坐标换算相关的字段（与引擎的 `FrameMetrics` 同形）。 */
export type CdpLiveFrameMetrics = Pick<BrowserLiveFramePayload, 'deviceWidth' | 'deviceHeight'>;

/** 画布 CSS 显示尺寸（由宿主的 ResizeObserver 测得）；缺省表示尚未测量。 */
export interface CdpLiveDisplaySize {
  width: number;
  height: number;
}

/** 画布 backing store 的定档输入。 */
export interface BackingSizeInput {
  bitmapWidth: number;
  bitmapHeight: number;
  /** 画面在页面上的 CSS 显示尺寸；缺省 / 非法时退回位图尺寸。 */
  displaySize?: CdpLiveDisplaySize | null;
  /** 纯前端缩放档位（与 CSS `transform: scale()` 一致）。 */
  zoom?: number;
  /** 显示器 DPR。 */
  devicePixelRatio?: number;
}

/**
 * 决定 `<canvas>` 的 backing store 尺寸。
 *
 * 之前直接按**位图尺寸**定档：帧盒可以宽到 2048 物理像素，于是每帧都要向合成器上传并
 * 缩放一张 2048 级的纹理，而它最终只显示在几百 CSS 像素的盒子里 —— 多出来的像素全是
 * 白白的纹理上传与合成开销。这里按「实际显示像素」定档：
 *
 * - 宽高**各自**按 `显示尺寸 × DPR × 缩放` 取整 —— 必须分别算，不能先算宽度再按位图
 *   宽高比推高度：`<canvas>` 的 CSS 尺寸就是 `displaySize`，两者取整方式不一致时
 *   浏览器会把 backing store 拉伸到 CSS 盒子里，画面就被拉变形了；
 * - 上限不超过位图本身（不放大：放大只会更糊，还多花一份插值）；
 * - 显示尺寸未测量时退回位图尺寸，保证首帧照常可画。
 *
 * 坐标映射不受影响：`deviceWidth / deviceHeight` 始终取自帧元数据，画布只是把位图
 * 缩到显示盒里。
 */
export function resolveBackingSize(input: BackingSizeInput): CdpLiveDisplaySize {
  const bitmapWidth = Math.max(1, Math.round(input.bitmapWidth));
  const bitmapHeight = Math.max(1, Math.round(input.bitmapHeight));

  const display = input.displaySize;
  if (display === undefined || display === null) {
    return { width: bitmapWidth, height: bitmapHeight };
  }
  if (!(display.width >= 1) || !(display.height >= 1)) {
    return { width: bitmapWidth, height: bitmapHeight };
  }

  const dpr =
    Number.isFinite(input.devicePixelRatio) && (input.devicePixelRatio ?? 0) > 0
      ? (input.devicePixelRatio as number)
      : 1;
  const zoom = Number.isFinite(input.zoom) && (input.zoom ?? 0) > 0 ? (input.zoom as number) : 1;

  return {
    width: Math.min(bitmapWidth, Math.max(1, Math.round(display.width * dpr * zoom))),
    height: Math.min(bitmapHeight, Math.max(1, Math.round(display.height * dpr * zoom))),
  };
}

export interface CdpLiveFramesOptions {
  session: BrowserLiveSession;
  /**
   * 为 true 时**丢弃**画面（仍回 ack 维持背压）。
   *
   * 用途：切标签 / 改地址之后，远端页面还停在旧文档上，会继续推**旧页面**的帧。
   * 只清一次画布不够——下一帧马上又把它画回来。宿主在「已要求导航、远端尚未确认」
   * 这段窗口把闸门拉上，等网关回报目标地址后再放开，画面才真的不会错位。
   */
  gateRef?: RefObject<boolean>;
  /**
   * 当前可接受的最小页面代次（`null` / 缺省 = 不做代次过滤）。
   *
   * 闸门只能挡住「导航确认之前」的帧，挡不住**快速来回切换**时的竞态：切走再切回，
   * 上一轮的旧帧可能在新一轮导航之后才到达，若只按时序判定就会画进新标签。
   * 帧自带 `generation` 时，低于该值的帧一律丢弃（仍回 ack）。
   */
  minGenerationRef?: RefObject<number | null>;
  /**
   * 画面在页面上的 CSS 显示尺寸（宿主测得）。
   *
   * 只用于给 canvas backing store 定档：按「显示尺寸 × DPR」定档能把「2048 宽的位图
   * 缩进几百像素盒子」这部分纹理上传 / 合成开销省掉。用 ref 而不是 props 值，是因为它
   * 随面板拖拽高频变化，进 React 只会引入无谓渲染。
   */
  displaySizeRef?: RefObject<CdpLiveDisplaySize | null>;
  /** 纯前端缩放档位（与 CSS `transform: scale()` 一致），同样参与 backing store 定档。 */
  zoomRef?: RefObject<number>;
}

/**
 * 画面链路的实测指标（1s 一个窗口刷新一次，供预览角标展示）。
 *
 * 三个数一起看才能定位瓶颈：
 * - `fps` 低 + `frameChars` 大 → 编码 / 传输 / 带宽是瓶颈；
 * - `fps` 低 + `processingMs` 接近帧间隔 → 主线程（解码 / 绘制）是瓶颈；
 * - `fps` 低但两者都小 → 页面本身没产生 damage（静态页），不是卡。
 */
export interface CdpLiveFrameStats {
  fps: number;
  /** 最近一帧的 base64 体量（字符数）。 */
  frameChars: number;
  /** 最近一帧从收到到 ack 的处理耗时（毫秒）。 */
  processingMs: number;
  /** 最近一帧在待解码槽中等待的耗时（毫秒）。 */
  queueMs: number;
  /** 最近一帧 JPEG 解码耗时（毫秒）。 */
  decodeMs: number;
  /** 最近一帧 Canvas 绘制耗时（毫秒）。 */
  paintMs: number;
}

/** 最近一次成功解码的真实 JPEG 位图尺寸。 */
export interface CdpLiveBitmapMetrics {
  width: number;
  height: number;
}

async function decodeFramePayload(
  payload: BrowserLiveFramePayload | BrowserLiveBinaryFramePayload,
  binary: boolean,
): Promise<DecodedFrame | null> {
  if (binary && payload.data instanceof ArrayBuffer) {
    return await decodeFrameFromBytes(payload.data, payload.mimeType);
  }
  return await decodeFrame({
    base64: typeof payload.data === 'string' ? payload.data : '',
    mimeType: payload.mimeType,
  });
}

export interface CdpLiveFrames {
  /** 画布宿主：引擎把它渲染成 `<canvas ref={canvasRef} />`。 */
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** 最近一帧的尺寸：指针输入换算坐标时同步读它，不经过 React 渲染。 */
  frameRef: RefObject<CdpLiveFrameMetrics | null>;
  /** 最近一帧的元数据尺寸；未收到帧时为 null。 */
  frameMetrics: CdpLiveFrameMetrics | null;
  /** 最近一次成功解码的真实位图尺寸；未解码成功时为 null。 */
  bitmapMetrics: CdpLiveBitmapMetrics | null;
  /** 是否已经收到过帧（阻断式状态文案据此让位）。 */
  hasFrame: boolean;
  /**
   * 清空画面（切标签时调用）。
   *
   * 实时分支只有一个 canvas、一个远端页面：切到一个新标签后，远端要等 navigate
   * 指令生效并产出新帧才会覆盖画面，这段空窗里用户会看到**上一个标签的内容**。
   * 切标签时先清空，语义上等同于浏览器切标签后的白屏加载态。
   */
  clear: () => void;
  /** 最近一个采样窗口的实测指标；尚无样本时全为 0。 */
  stats: CdpLiveFrameStats;
}

export function useCdpLiveFrames({
  session,
  gateRef,
  minGenerationRef,
  displaySizeRef,
  zoomRef,
}: CdpLiveFramesOptions): CdpLiveFrames {
  const { send, subscribe } = session;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<CdpLiveFrameMetrics | null>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  /** 解码代次：只允许最新一代绘制，避免旧帧覆盖新帧。 */
  const generationRef = useRef(0);
  const [frameMetrics, setFrameMetrics] = useState<CdpLiveFrameMetrics | null>(null);
  const [bitmapMetrics, setBitmapMetrics] = useState<CdpLiveBitmapMetrics | null>(null);
  const [hasFrame, setHasFrame] = useState(false);
  const [stats, setStats] = useState<CdpLiveFrameStats>({
    fps: 0,
    frameChars: 0,
    processingMs: 0,
    queueMs: 0,
    decodeMs: 0,
    paintMs: 0,
  });
  /** 与 `hasFrame` 同步的守卫：收帧是高频路径，避免每帧一次无意义的 setState。 */
  const hasFrameRef = useRef(false);
  /** 与 `frameMetrics` 同步的守卫：尺寸没变就不进 React 调度（每帧一次也不便宜）。 */
  const metricsRef = useRef<CdpLiveFrameMetrics | null>(null);
  /** 与 `bitmapMetrics` 同步的守卫：解码尺寸没变就不进 React 调度。 */
  const bitmapMetricsRef = useRef<CdpLiveBitmapMetrics | null>(null);
  type PendingFrame = {
    payload: BrowserLiveFramePayload | BrowserLiveBinaryFramePayload;
    receivedAt: number;
    binary: boolean;
  };
  const pendingFrameRef = useRef<PendingFrame | null>(null);
  const ackRef = useRef<(frameSessionId: number) => void>(() => undefined);
  const resetSamplingRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let disposed = false;
    /** 帧率采样窗口：起算时刻与窗口内已收帧数。 */
    let fpsWindowStartedAt =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    let fpsWindowFrames = 0;
    /** 窗口内最近一帧的体量与处理耗时（窗口结束时随 fps 一起刷新）。 */
    let lastFrameChars = 0;
    let lastProcessingMs = 0;
    let lastQueueMs = 0;
    let lastDecodeMs = 0;
    let lastPaintMs = 0;

    const now = (): number =>
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();

    /**
     * 回 ack（背压信用）：消费完成即放行下一帧，不做任何额外等待。
     *
     * ack 自身也属于外部边界：测试替身、断线中的 session 或异常 transport 都可能
     * 同步抛错。这里吞掉这类 transport 错误并记录，避免它打断 drain，导致后续帧
     * 永久停在「解码完成但没有归还信用」的状态。
     */
    const ack = (frameSessionId: number): void => {
      try {
        send({ ch: 'ack', frameSessionId });
      } catch (error) {
        console.warn('[browser-live] 帧 ack 发送失败：', error);
      }
    };
    ackRef.current = ack;
    resetSamplingRef.current = () => {
      fpsWindowStartedAt = now();
      fpsWindowFrames = 0;
      lastFrameChars = 0;
      lastProcessingMs = 0;
      lastQueueMs = 0;
      lastDecodeMs = 0;
      lastPaintMs = 0;
    };

    const paint = (decoded: DecodedFrame): boolean => {
      const canvas = canvasRef.current;
      if (canvas === null) return false;
      // backing store 按「显示尺寸 × DPR」定档，而不是按位图尺寸：位图可能有 2048 宽，
      // 最终只显示在几百像素的盒子里，按位图定档等于每帧上传并缩放一张大纹理。
      // 尺寸没变就不重设（重设会清空并重新分配，代价远高于一次 drawImage 缩放）。
      const backing = resolveBackingSize({
        bitmapWidth: decoded.width,
        bitmapHeight: decoded.height,
        // 两个 ref 都是可选注入：未传时退回「按位图尺寸定档」，行为与改造前一致。
        displaySize: displaySizeRef?.current ?? null,
        zoom: zoomRef?.current,
        devicePixelRatio: typeof window === 'undefined' ? 1 : window.devicePixelRatio,
      });
      if (canvas.width !== backing.width || canvas.height !== backing.height) {
        canvas.width = backing.width;
        canvas.height = backing.height;
      }
      // `alpha: false` 省掉逐帧的透明混合；`desynchronized: true` 允许浏览器走低延迟
      // 绘制路径（不强制等合成器同步），实时画面只关心「尽快看到最新一帧」。
      // 这两个开关只在首次取上下文时生效，因此与 contextRef 的缓存绑定在一起。
      const context =
        contextRef.current ?? canvas.getContext('2d', { alpha: false, desynchronized: true });
      contextRef.current = context;
      if (context === null) return false;
      // 显式给定目标尺寸：位图缩放到 backing store（两者宽高比一致，不会拉伸）。
      context.drawImage(decoded.source, 0, 0, backing.width, backing.height);
      return true;
    };

    /**
     * 等待解码的「最新一帧」与串行化解码。
     *
     * 网关改成「收到帧就 ack CDP」后，controller 侧最多有
     * `BROWSER_LIVE_HIGH_WATER_FRAMES` 帧在途。如果这里对每帧都直接
     * `void consume(...)`，客户端跟不上时就会**并发解码好几张 JPEG**，而除最新那张外
     * 全部会被代次判定丢弃——解码正是整条链路里最贵的一段（百 KB 级 JPEG 一次几毫秒），
     * 白解两次就把预算吃光，表现为「画面还在动但明显卡」。
     *
     * 因此：只保留最新一帧、同时只允许一个解码在飞。被顶掉的帧立刻归还配额（网关已经
     * 把它计入在途列表），既不让 CPU 白烧，也不会让配额占到 watchdog。
     */
    let pendingFrame: PendingFrame | null = null;
    let draining = false;

    const consume = async (
      payload: BrowserLiveFramePayload | BrowserLiveBinaryFramePayload,
      receivedAt: number,
      binary: boolean,
    ): Promise<void> => {
      const generation = generationRef.current + 1;
      generationRef.current = generation;

      const decodeStartedAt = now();
      lastQueueMs = Math.max(0, decodeStartedAt - receivedAt);

      let decoded: DecodedFrame | null = null;
      try {
        decoded = await decodeFramePayload(payload, binary);
      } catch (error) {
        // 解码失败不能吞：记日志，但仍然要放行下一帧。
        console.warn('[browser-live] 帧解码失败：', error);
      }
      lastDecodeMs = Math.max(0, now() - decodeStartedAt);

      // 刻意不用 try/finally：`finally` 会被 React Compiler 判成 compiler-limit
      // （`Handle TryStatement without a catch clause`）并让整个 hook 退出优化。
      if (decoded !== null && !disposed && generation === generationRef.current) {
        const bitmap = { width: decoded.width, height: decoded.height };
        if (
          bitmapMetricsRef.current === null ||
          bitmapMetricsRef.current.width !== bitmap.width ||
          bitmapMetricsRef.current.height !== bitmap.height
        ) {
          bitmapMetricsRef.current = bitmap;
          setBitmapMetrics(bitmap);
        }
        const paintStartedAt = now();
        let painted = false;
        try {
          painted = paint(decoded);
        } catch (error) {
          console.warn('[browser-live] 画布绘制失败：', error);
        }
        lastPaintMs = Math.max(0, now() - paintStartedAt);
        if (painted) {
          lastFrameChars =
            payload.data instanceof ArrayBuffer ? payload.data.byteLength : payload.data.length;
          fpsWindowFrames += 1;
          const windowElapsed = now() - fpsWindowStartedAt;
          if (windowElapsed >= FPS_SAMPLE_WINDOW_MS) {
            const nextStats = computeFrameStats({
              frames: fpsWindowFrames,
              elapsedMs: windowElapsed,
              lastFrameChars,
              lastProcessingMs,
              lastQueueMs,
              lastDecodeMs,
              lastPaintMs,
            });
            setStats((previous) =>
              previous.fps === nextStats.fps &&
              previous.frameChars === nextStats.frameChars &&
              previous.processingMs === nextStats.processingMs &&
              previous.queueMs === nextStats.queueMs &&
              previous.decodeMs === nextStats.decodeMs &&
              previous.paintMs === nextStats.paintMs
                ? previous
                : nextStats,
            );
            fpsWindowFrames = 0;
            fpsWindowStartedAt = now();
          }
        }
      } else {
        lastPaintMs = 0;
      }
      if (decoded !== null) {
        try {
          decoded.release();
        } catch (error) {
          console.warn('[browser-live] 帧资源释放失败：', error);
        }
      }
      lastProcessingMs = Math.max(0, now() - receivedAt);
    };

    /**
     * 收帧入口：只留最新一帧，串行解到底。
     *
     * 「只留最新」是这里的关键——客户端解码慢于网关下发时，排队中的旧帧即使解出来也会
     * 立刻被更新的一帧覆盖（`generation` 判定）。与其并发解码一堆马上作废的 JPEG，
     * 不如直接丢旧帧、只解最新那一张，并把被顶掉帧的配额当场还回去。
     */
    const enqueue = (
      payload: BrowserLiveFramePayload | BrowserLiveBinaryFramePayload,
      receivedAt: number,
      binary: boolean,
    ): void => {
      // clear() 只能通过 ref 同步通知 effect；若 drain 当前正忙，闭包里的
      // pendingFrame 可能还保留着那份已被 clear() ack 的对象。先丢掉这个失效引用，
      // 否则下一帧到达时会二次 ack，网关会把它视为重复确认。
      if (pendingFrame !== null && pendingFrameRef.current !== pendingFrame) {
        pendingFrame = null;
      }
      const superseded = pendingFrame;
      pendingFrame = { payload, receivedAt, binary };
      pendingFrameRef.current = pendingFrame;
      if (superseded !== null) {
        // 这一帧永远不会被解码：立即归还配额，别让它占到 watchdog。
        ack(superseded.payload.frameSessionId);
      }
      if (draining) return;
      draining = true;
      void drain();
    };

    const consumeNext = async (next: PendingFrame): Promise<void> => {
      try {
        await consume(next.payload, next.receivedAt, next.binary);
      } catch (error) {
        console.warn('[browser-live] 帧消费链路失败：', error);
      }
      // consume 内部只负责解码 / 绘制；try/catch 覆盖所有未预期分支，
      // 因而这里是每帧唯一的 controller 配额归还点，同时不引入 React Compiler
      // 无法优化的 try/finally 结构。
      ack(next.payload.frameSessionId);
    };

    /** 串行消费队列：一次只解一帧，解完立刻取走期间到达的最新一帧。 */
    const drain = async (): Promise<void> => {
      while (!disposed) {
        const next = pendingFrame;
        if (next === null) break;
        // clear() 在 effect 外部执行，只能把 ref 置空；这里识别出已经被 clear()
        // 立即 ack 的排队帧并跳过，避免解码后再次 ack 同一 frameSessionId。
        if (pendingFrameRef.current !== next) {
          pendingFrame = null;
          continue;
        }
        pendingFrame = null;
        pendingFrameRef.current = null;
        await consumeNext(next);
      }
      // 用「是否还有待处理帧」决定是否继续，而不是无条件复位：`consume` 期间可能
      // 又推进来了新帧（`draining` 仍是 true，那边不会另起一条链）。
      draining = false;
      if (!disposed && pendingFrame !== null) {
        draining = true;
        void drain();
      }
    };

    const unsubscribe = subscribe((envelope) => {
      if (envelope.ch !== 'frame') return;
      const payload = envelope.payload as BrowserLiveFramePayload | BrowserLiveBinaryFramePayload;
      const binary = payload.data instanceof ArrayBuffer;
      const dataLength = payload.data instanceof ArrayBuffer ? payload.data.byteLength : 0;
      const textLength = typeof payload.data === 'string' ? payload.data.length : 0;
      if (
        (binary ? dataLength : textLength) === 0 ||
        !(payload.deviceWidth > 0) ||
        !(payload.deviceHeight > 0)
      ) {
        // 载荷无效：不画、不统计，但**必须**归还配额——网关已经把它记进在途列表了，
        // 漏一条就少一个下发名额，直到 watchdog 才回收。
        ack(payload.frameSessionId);
        return;
      }

      const receivedAt = now();
      // 闸门拉上时（切标签 / 改地址后远端还停在旧文档）这些帧属于**旧页面**：
      // 不统计、不更新尺寸、不标记「已有画面」，更不解码绘制——否则会污染
      // 「等待实时画面…」的判定与帧率统计。仍然回 ack，否则配额要等 watchdog。
      if (gateRef?.current === true) {
        ack(payload.frameSessionId);
        return;
      }

      // 代次过滤：快速来回切标签时，上一轮页面产出的帧可能晚于新导航到达。只按时序
      // 判定无法区分，这里按「不小于当前可接受代次」硬性丢弃（老网关无该字段则跳过）。
      // 只读判定：门槛由宿主（引擎）在收到更新代次时抬高，本 hook 不写回参数——
      // 修改 hook 参数会被 React Compiler 判为非法并让整个组件脱靶优化。
      const minGeneration = minGenerationRef?.current ?? null;
      if (typeof payload.generation === 'number' && minGeneration !== null) {
        if (payload.generation < minGeneration) {
          ack(payload.frameSessionId);
          return;
        }
      }

      const nextMetrics: CdpLiveFrameMetrics = {
        deviceWidth: payload.deviceWidth,
        deviceHeight: payload.deviceHeight,
      };
      frameRef.current = nextMetrics;
      const metrics = metricsRef.current;
      if (
        metrics === null ||
        metrics.deviceWidth !== payload.deviceWidth ||
        metrics.deviceHeight !== payload.deviceHeight
      ) {
        metricsRef.current = nextMetrics;
        setFrameMetrics(nextMetrics);
      }
      if (!hasFrameRef.current) {
        hasFrameRef.current = true;
        setHasFrame(true);
      }

      enqueue(payload, receivedAt, binary);
    });

    return () => {
      disposed = true;
      // 卸载时把还没解码的排队帧一并归还配额：网关已经把它们算进在途列表，
      // 漏掉就要等 watchdog 才回收（重连后首帧会被这份历史拖慢）。
      const dropped = pendingFrame;
      pendingFrame = null;
      pendingFrameRef.current = null;
      if (dropped !== null) {
        ack(dropped.payload.frameSessionId);
      }
      unsubscribe();
      ackRef.current = () => undefined;
      resetSamplingRef.current = null;
    };
  }, [subscribe, send, gateRef, minGenerationRef]);

  /**
   * 清空画面。必须同步执行（切标签的 render 之后立刻生效），因此放在渲染函数里
   * 用 `useCallback` 暴露，而不是塞进上面的 effect。
   */
  const clear = useCallback((): void => {
    generationRef.current += 1;
    const dropped = pendingFrameRef.current;
    pendingFrameRef.current = null;
    if (dropped !== null) {
      ackRef.current(dropped.payload.frameSessionId);
    }
    frameRef.current = null;
    metricsRef.current = null;
    setFrameMetrics(null);
    // 同时把 `hasFrame` 复位：清空后画面确实没有内容，阻断式文案（「等待实时画面…」）
    // 必须重新出现，否则用户面对的是一块没有任何解释的空白区域。
    if (hasFrameRef.current) {
      hasFrameRef.current = false;
      setHasFrame(false);
    }
    if (bitmapMetricsRef.current !== null) {
      bitmapMetricsRef.current = null;
      setBitmapMetrics(null);
    }
    resetSamplingRef.current?.();
    setStats({
      fps: 0,
      frameChars: 0,
      processingMs: 0,
      queueMs: 0,
      decodeMs: 0,
      paintMs: 0,
    });
    const canvas = canvasRef.current;
    if (canvas === null) return;
    // 必须与 `paint` 用**同一组**选项：`getContext` 的选项只在首次创建上下文时生效。
    // 切标签时 `clear` 往往先于首帧执行，若这里用默认选项建了上下文，之后 `paint`
    // 传的 `alpha: false` / `desynchronized: true` 就会被静默忽略——每帧多一次透明
    // 混合，且失去低延迟合成路径，正是这次要优化掉的那部分开销。
    const context =
      contextRef.current ?? canvas.getContext('2d', { alpha: false, desynchronized: true });
    contextRef.current = context;
    if (context === null) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  return { canvasRef, frameRef, frameMetrics, bitmapMetrics, hasFrame, stats, clear };
}
