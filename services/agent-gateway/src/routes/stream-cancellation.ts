/**
 * Optional metadata attached to a stop call so the stream's abort
 * handler can render a precise "由父会话中断" toast instead of the
 * generic "已停止" (T-CANCEL-08, workflow 260509).
 *
 * The keys mirror `CancelDescendantReason` from
 * `cancel-descendant-streams.ts`. We deliberately keep this as a
 * loose string union on the entry side to avoid pulling that module
 * into the cancellation helper's import graph.
 */
export type StreamCancelHint = 'user_aborted' | 'parent_aborted' | 'ancestor_aborted';

export interface InFlightStreamRequestEntry {
  abortController: AbortController;
  clientRequestId: string;
  execution: Promise<{ statusCode: number }>;
  userId: string;
  /**
   * 登记时刻(ms 时间戳),供 TTL 回收使用。见 `STREAM_REQUEST_LOCK_TTL_MS`。
   */
  startedAt: number;
  /**
   * Set by `stop*` helpers right before `abort()` fires so the
   * stream's catch handler can read the reason synchronously and
   * forward it onto the emitted `done` chunk's cancellation summary.
   * Stays unset for ordinary user-driven stops (which still default
   * to `user_aborted`).
   */
  pendingCancelReason?: StreamCancelHint;
}

export interface InFlightStreamReservation {
  abortController: AbortController;
  execution: Promise<{ statusCode: number }>;
  owner: boolean;
  reject: (reason: unknown) => void;
  resolve: (value: { statusCode: number }) => void;
}

const NOOP_RESOLVE = (_value: { statusCode: number }): void => undefined;
const NOOP_REJECT = (_reason: unknown): void => undefined;

/**
 * 运行锁 TTL —— `execution` 永不 settle 时的最后防线。
 *
 * 锁的正常释放点是 `stream.ts` 的 `finally { clearReservation() }`。若某一轮因上游
 * stall、SSH 阻塞等原因既 resolve 也不 reject,该 entry 会永久驻留,导致该会话后续
 * 所有请求恒定返回 409 `SESSION_ALREADY_RUNNING`,直到网关重启。
 *
 * TTL 取值远大于任何合法回合时长(上游 idle 看门狗为 30 分钟),仅用于回收这类
 * 已判定死亡的 entry,正常请求永远不会被它误伤。
 */
export const STREAM_REQUEST_LOCK_TTL_MS = 2 * 60 * 60 * 1000;

const inFlightStreamRequests = new Map<string, InFlightStreamRequestEntry>();

function getStreamRequestKey(sessionId: string, clientRequestId: string): string {
  return `${sessionId}:${clientRequestId}`;
}

/**
 * 判定 entry 是否已超过 TTL。
 *
 * 若 `startedAt` 因异常路径缺失,`now - undefined` 为 NaN,与 TTL 的比较恒为 false
 * ——即按「未过期」处理,不会把可能仍存活的锁提前回收。
 */
function isExpiredStreamRequest(entry: InFlightStreamRequestEntry, now: number): boolean {
  return now - entry.startedAt >= STREAM_REQUEST_LOCK_TTL_MS;
}

export function getInFlightStreamRequest(
  sessionId: string,
  clientRequestId: string,
): InFlightStreamRequestEntry | undefined {
  const key = getStreamRequestKey(sessionId, clientRequestId);
  const entry = inFlightStreamRequests.get(key);
  if (!entry) return undefined;
  if (isExpiredStreamRequest(entry, Date.now())) {
    inFlightStreamRequests.delete(key);
    return undefined;
  }
  return entry;
}

export function reserveInFlightStreamRequest(input: {
  clientRequestId: string;
  sessionId: string;
  userId: string;
}): InFlightStreamReservation {
  const key = getStreamRequestKey(input.sessionId, input.clientRequestId);
  const existing = inFlightStreamRequests.get(key);
  if (existing) {
    // 未过期的同 clientRequestId 请求:single-flight,复用其 execution。
    // 已过 TTL 的 entry 视为死亡锁:回收后由本次调用重新登记为 owner,
    // 否则同 id 的重试会在 stream.ts 的等待循环里永远挂住。
    if (!isExpiredStreamRequest(existing, Date.now())) {
      return {
        abortController: existing.abortController,
        execution: existing.execution,
        owner: false,
        reject: NOOP_REJECT,
        resolve: NOOP_RESOLVE,
      };
    }
    inFlightStreamRequests.delete(key);
  }

  let resolveExecution: (value: { statusCode: number }) => void = NOOP_RESOLVE;
  let rejectExecution: (reason: unknown) => void = NOOP_REJECT;
  const execution = new Promise<{ statusCode: number }>((resolve, reject) => {
    resolveExecution = resolve;
    rejectExecution = reject;
  });
  void execution.catch(() => undefined);
  const abortController = new AbortController();
  inFlightStreamRequests.set(key, {
    abortController,
    clientRequestId: input.clientRequestId,
    execution,
    startedAt: Date.now(),
    userId: input.userId,
  });

  return {
    abortController,
    execution,
    owner: true,
    reject: rejectExecution,
    resolve: resolveExecution,
  };
}

export function registerInFlightStreamRequest(input: {
  abortController: AbortController;
  clientRequestId: string;
  execution: Promise<{ statusCode: number }>;
  sessionId: string;
  userId: string;
}): void {
  inFlightStreamRequests.set(getStreamRequestKey(input.sessionId, input.clientRequestId), {
    abortController: input.abortController,
    clientRequestId: input.clientRequestId,
    execution: input.execution,
    startedAt: Date.now(),
    userId: input.userId,
  });
}

export function getAnyInFlightStreamRequestForSession(input: {
  excludeClientRequestId?: string;
  sessionId: string;
  userId: string;
}): InFlightStreamRequestEntry | undefined {
  const now = Date.now();
  for (const [key, entry] of inFlightStreamRequests.entries()) {
    if (!key.startsWith(`${input.sessionId}:`) || entry.userId !== input.userId) {
      continue;
    }

    // 顺手回收本会话下的死亡锁:避免它们冒充「正在运行」而让后续请求恒定 409。
    if (isExpiredStreamRequest(entry, now)) {
      inFlightStreamRequests.delete(key);
      continue;
    }

    if (input.excludeClientRequestId && entry.clientRequestId === input.excludeClientRequestId) {
      continue;
    }

    return entry;
  }

  return undefined;
}

export function clearInFlightStreamRequest(input: {
  clientRequestId: string;
  execution: Promise<{ statusCode: number }>;
  sessionId: string;
}): void {
  const key = getStreamRequestKey(input.sessionId, input.clientRequestId);
  const current = inFlightStreamRequests.get(key);
  if (current?.execution === input.execution) {
    inFlightStreamRequests.delete(key);
  }
}

export async function stopInFlightStreamRequest(input: {
  clientRequestId: string;
  sessionId: string;
  userId: string;
  /** Optional reason hint so the stream's abort handler can label the
   *  emitted `done.cancellation.reason` precisely (T-CANCEL-08). */
  reason?: StreamCancelHint;
}): Promise<boolean> {
  const current = getInFlightStreamRequest(input.sessionId, input.clientRequestId);
  if (!current || current.userId !== input.userId) {
    return false;
  }

  if (input.reason) current.pendingCancelReason = input.reason;
  current.abortController.abort();
  await current.execution.catch(() => undefined);
  return true;
}

export async function stopAnyInFlightStreamRequestForSession(input: {
  sessionId: string;
  userId: string;
  reason?: StreamCancelHint;
}): Promise<boolean> {
  const current = getAnyInFlightStreamRequestForSession(input);
  if (!current) {
    return false;
  }

  if (input.reason) current.pendingCancelReason = input.reason;
  current.abortController.abort();
  await current.execution.catch(() => undefined);
  return true;
}

export async function stopAllInFlightStreamRequestsForSession(input: {
  sessionId: string;
  userId: string;
  reason?: StreamCancelHint;
}): Promise<number> {
  let stoppedCount = 0;

  while (await stopAnyInFlightStreamRequestForSession(input)) {
    stoppedCount += 1;
  }

  return stoppedCount;
}

/**
 * Read-only accessor used by the stream abort handler to decide
 * whether the in-flight stop was triggered by the user, by a parent
 * cascade, or by an ancestor cascade. Falls back to `'user_aborted'`
 * when no caller stamped a hint, preserving the legacy default.
 */
export function readPendingCancelReason(
  sessionId: string,
  clientRequestId: string,
): StreamCancelHint {
  const entry = getInFlightStreamRequest(sessionId, clientRequestId);
  return entry?.pendingCancelReason ?? 'user_aborted';
}
