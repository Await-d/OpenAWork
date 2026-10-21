/**
 * 网关事件循环 lag 观测。
 *
 * 背景：网关用**同步** `bun:sqlite`（`PRAGMA busy_timeout=5000`）。任何一次
 * `BEGIN IMMEDIATE` 撞上其它会话的并发写，都会把整个事件循环同步阻塞最长 5 秒。
 * 阻塞期间网关不处理任何东西——`/status` 之类的 HTTP 请求排队、SSE 心跳
 * （attach 的 10s `: keepalive`）写不出去、以及所有在途 fetch 一起积压。
 *
 * 症状横跨三个原本看起来无关的问题：
 *   - 「发一条消息到出字」停顿明显；
 *   - 偶发 `attach_stream_disconnected`（心跳写失败后服务端主动收尾）；
 *   - 页面整体卡顿、请求排队。
 *
 * 本模块用标准的事件循环 lag 探针（定时器实际触发时刻 − 预期时刻）直接测量
 * 「被卡了多久」，命中即打日志，让这条因果链**可被观测**而不是靠推测。
 *
 * 只观测、不改变任何行为；关闭方式：`OPENAWORK_EVENT_LOOP_LAG_MONITOR=0`
 * （或把阈值 `OPENAWORK_EVENT_LOOP_LAG_THRESHOLD_MS` 调到极大值）。
 */

/** 默认阈值：50ms。低于它属于正常调度抖动，无需记录。 */
const DEFAULT_LAG_THRESHOLD_MS = 50;
/** 探针间隔；太密会放大自身开销，太疏会漏掉短阻塞。 */
const PROBE_INTERVAL_MS = 250;
/**
 * 同一原因的最短重复上报间隔。
 *
 * 一次长阻塞会让探针「补齐」多拍（错过的定时器会连续触发），逐拍打日志会把
 * 一次事件放大成几十条，反而淹没真正的现场。
 */
const DEFAULT_REPEAT_SUPPRESS_MS = 5_000;

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isMonitorEnabled(env: NodeJS.ProcessEnv): boolean {
  const flag = env['OPENAWORK_EVENT_LOOP_LAG_MONITOR'];
  return flag === undefined || flag === '1' || flag.toLowerCase() === 'true';
}

export interface EventLoopLagMonitor {
  stop: () => void;
}

/**
 * 启动 lag 探针。返回的 `stop` 供测试与优雅关闭使用。
 *
 * 记录形态：`log` 直接注入，避免本模块依赖网关的 logger 单例（那会引入
 * 循环依赖，也让它无法被单测独立驱动）。
 */
export function startEventLoopLagMonitor(
  log: { warn: (payload: Record<string, unknown>, message: string) => void },
  env: NodeJS.ProcessEnv = process.env,
): EventLoopLagMonitor {
  const thresholdMs = readPositiveIntEnv(
    'OPENAWORK_EVENT_LOOP_LAG_THRESHOLD_MS',
    DEFAULT_LAG_THRESHOLD_MS,
  );
  if (!isMonitorEnabled(env)) {
    return { stop: () => undefined };
  }

  const repeatSuppressMs = readPositiveIntEnv(
    'OPENAWORK_EVENT_LOOP_LAG_REPEAT_SUPPRESS_MS',
    DEFAULT_REPEAT_SUPPRESS_MS,
  );
  let expectedAtMs = Date.now() + PROBE_INTERVAL_MS;
  /**
   * 上次上报时刻；`null` = 尚未上报过。
   *
   * 刻意用 `null` 而不是 0：0 是 epoch 起点，「距上次上报多久」在首次上报时会变成
   * 一个取决于进程启动时钟的巨大值，判定结果依赖时钟起点而非语义。
   */
  let lastReportedAtMs: number | null = null;
  let stopped = false;

  const timer = setInterval(() => {
    if (stopped) {
      return;
    }
    const nowMs = Date.now();
    const lagMs = nowMs - expectedAtMs;
    // 按实际触发时刻重排基准，而不是固定累加：固定累加在长阻塞后会让探针
    // 「追赶」很久，把一次阻塞误报成连续几十次。
    expectedAtMs = nowMs + PROBE_INTERVAL_MS;
    const suppressed = lastReportedAtMs !== null && nowMs - lastReportedAtMs < repeatSuppressMs;
    if (lagMs < thresholdMs || suppressed) {
      return;
    }
    lastReportedAtMs = nowMs;
    log.warn(
      { lagMs, thresholdMs },
      `[event-loop-lag] 事件循环被阻塞 ${lagMs}ms（阈值 ${thresholdMs}ms）。` +
        '此时 SQLite 写事务在争用写锁，SSE 心跳 /status 等请求会一起排队——' +
        '若伴随 attach 断线或首 token 变慢，优先排查写事务数量。',
    );
  }, PROBE_INTERVAL_MS);

  // 不阻止进程退出：这是纯观测定时器。
  timer.unref?.();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
