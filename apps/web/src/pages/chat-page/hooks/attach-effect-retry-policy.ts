/**
 * attach 重连退避策略与连续性状态：常量、退避解析函数与进度状态工厂。
 */

export const ATTACH_STORM_WINDOW_MS = 60_000;
export const ATTACH_STORM_MAX_ATTEMPTS = 10;
/**
 * 连续多少次重连时 `lastSeq` 完全没有前进，就判定流已僵死并停止重连。
 *
 * 正常流式期间每次断开前都会有新事件（`lastSeq` 前进），计数会被重置；只有
 * 「网关报活跃、SSE 打开即结束」的僵死状态才会连续命中。
 */
/**
 * 反复中断时的重连退避序列。
 *
 * 与 `SILENT_CLOSE_RETRY_DELAYS_MS` 的区别：这里对应的是「attach 建立过、收到过事件、
 * 又断开」——即连接**真的建立过又掉了**，比 0 事件的等待更可疑，因此起步更慢
 * （800ms）以便尽快恢复，同时逐级退避，避免退化成高频循环。
 *
 * 关键点：退避基数**不能**依赖 `useStreamAttachRetry` 内部的 `retryAttemptRef`——
 * 它会在每次 attach 成功后被 `cancelAttachRetry()` 清零，于是「成功 → 又断开」
 * 永远是第一次尝试、恒定 400ms，并在每轮全量重载快照。这就是页面卡死的成因之一，
 * 也是本页最初的故障现象。
 */
export const DISCONNECT_RETRY_DELAYS_MS = [
  800, 1_600, 3_200, 6_400, 12_800, 25_600, 30_000,
] as const;

export function resolveDisconnectRetryDelayMs(disconnects: number): number {
  const index = Math.min(Math.max(disconnects - 1, 0), DISCONNECT_RETRY_DELAYS_MS.length - 1);
  return DISCONNECT_RETRY_DELAYS_MS[index]!;
}

/**
 * 连接至少稳定存活该时长，才认为「上次的中断是偶发」，允许把失败计数归零。
 *
 * 立刻归零会让「秒断」场景退回固定 400ms 循环；永，归零则一次网络抖动后要等很久
 * 才能恢复正常。30s 是权衡点：超过它才认为这条连接真的稳定过。
 */
export const STABLE_ATTACH_WINDOW_MS = 30_000;

/**
 * 等待新输出时的退避序列。
 *
 * 工具执行（bash / mcp / 长思考）期间网关不产生 run event，attach 只会「打开 → 0
 * 事件 → EOF」。此时应低频重挂等待，而不是高频重连：每轮重连都会清空流缓冲并全量
 * 重载一次会话快照，工具跑得越久卡顿越明显。
 *
 * 封顶 10s（不是 30s）：每次尝试的开销只是「一次活跃流查询 + 一次 SSE 建连」，
 * 不含快照重载，10s 一次完全可以承受；而工具一旦结束，输出最迟 10s 内就能接上。
 */
export const SILENT_CLOSE_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 10_000] as const;

export function resolveSilentCloseRetryDelayMs(silentCloses: number): number {
  const index = Math.min(Math.max(silentCloses - 1, 0), SILENT_CLOSE_RETRY_DELAYS_MS.length - 1);
  return SILENT_CLOSE_RETRY_DELAYS_MS[index]!;
}

/**
 * attach 连续性状态：跨 effect 运行持久，用于识别「无进展」的重连循环。
 */
export interface AttachProgressState {
  /** 上次记录归属的会话。 */
  sessionId: string | null;
  /** 上次确认到的服务端事件游标。 */
  lastSeq: number;
  /** 连续「打开后 0 事件」的次数。 */
  silentCloses: number;
  /** 连续「游标没有前进」的重连次数。 */
  stalledReconnects: number;
  /**
   * 连续「attach 建立后又断开」的次数。
   *
   * **不因 attach 成功而清零**：只有连接稳定存活 `STABLE_ATTACH_WINDOW_MS` 后才归零
   * （见 `handleAttachReconnect`）。否则秒断场景会退回固定 400ms 循环。
   */
  disconnects: number;
  /** 本次 attach 建立连接的时刻，用于判断连接是否稳定存活过。 */
  attachedAt: number;
}

export function createInitialAttachProgressState(): AttachProgressState {
  return {
    attachedAt: 0,
    disconnects: 0,
    lastSeq: -1,
    sessionId: null,
    silentCloses: 0,
    stalledReconnects: 0,
  };
}
