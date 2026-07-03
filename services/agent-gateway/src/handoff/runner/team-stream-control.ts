/**
 * team-stream-control · 团队层流式执行的「带内」取消/暂停响应
 *
 * 背景（健壮性补强 · 跨层交流）：
 *   团队五层里真正干活的 executor / reviewer / pm2 都走 routes/stream.ts 的统一
 *   round 循环（runSessionInBackground → handleStreamRequest）。但早期这条循环
 *   **从不读取** session_inbound_messages 里的 cancel_signal / pause_signal —— 只有
 *   pm1 的澄清等待循环（artifact-chain.ts）消费 inbound。结果：
 *     - 用户点「取消任务」/ reception 的 cancel_downstream 把 cancel_signal 写进库，
 *       但下游正在跑的 LLM 循环看不到它，继续烧 token、继续写工具结果，直到自然结束。
 *     - pause/resume 同理失效。
 *
 *   这是跨层「反向控制信道」断裂。本模块提供一个**每个 round 之间**调用的轻量 gate：
 *     - 命中 cancel_signal → 抛 AbortError（复用既有 abort 通道：emit done(cancelled)
 *       + 取消子流 + 置 substate）。
 *     - 命中 pause_signal → 阻塞轮询，直到 resume_signal / cancel_signal / 截止时间。
 *
 *   只对团队五层 session 生效；普通 chat session（roleLayer 为空）原样跳过，零开销。
 *
 * 设计要点：
 *   - 只消费 cancel/pause/resume 三类控制信号（consumePendingControlSignal），
 *     绝不吞 clarification / user_input / progress_report 等业务消息。
 *   - pause 有**最大阻塞墙钟**（默认 30 min）兜底，避免永久卡死占用 in-flight 槽。
 *   - signal.aborted（用户在前端直接 stop）优先于一切，立即中止。
 */

import {
  consumePendingControlSignal,
  type InboundControlSignalType,
} from '../store/inbound-store.js';

const TEAM_LAYERS = new Set(['reception', 'pm1', 'pm2', 'executor', 'reviewer']);

/** pause 状态下的轮询间隔（ms）。 */
export const TEAM_PAUSE_POLL_INTERVAL_MS = 1_000;

/** pause 状态下的最大阻塞时长（ms）。超过即放弃等待并按取消处理，避免永久占用执行槽。 */
export const TEAM_PAUSE_MAX_BLOCK_MS = 30 * 60 * 1000;

export type TeamControlGateOutcome = { kind: 'continue' } | { kind: 'cancelled'; reason: string };

export function isTeamControlledRoleLayer(roleLayer: string | null | undefined): boolean {
  return typeof roleLayer === 'string' && TEAM_LAYERS.has(roleLayer);
}

function controlSignalReason(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const reason = (payload as Record<string, unknown>)['reason'];
    if (typeof reason === 'string' && reason.trim().length > 0) {
      return reason;
    }
  }
  return fallback;
}

export interface CheckTeamControlSignalsDeps {
  consume?: typeof consumePendingControlSignal;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * 在一个团队 round 边界检查并响应控制信号。
 *
 * @returns
 *   - { kind: 'continue' } 表示可以继续下一个 round。
 *   - { kind: 'cancelled', reason } 表示收到 cancel（或 pause 超时），调用方应中止执行。
 *
 * 注意：本函数本身不抛错（除非 deps.sleep 抛）。调用方根据返回值决定是否抛 AbortError，
 * 这样既能被现有 abort 通道统一处理，又方便单测断言。
 */
export async function checkTeamControlSignals(input: {
  sessionId: string;
  roleLayer: string | null | undefined;
  signal: AbortSignal;
  round: number;
  pausePollIntervalMs?: number;
  pauseMaxBlockMs?: number;
  deps?: CheckTeamControlSignalsDeps;
}): Promise<TeamControlGateOutcome> {
  if (!isTeamControlledRoleLayer(input.roleLayer)) {
    return { kind: 'continue' };
  }

  const consume = input.deps?.consume ?? consumePendingControlSignal;
  const now = input.deps?.now ?? Date.now;
  const sleep =
    input.deps?.sleep ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        (timer as { unref?: () => void }).unref?.();
      }));
  const pollIntervalMs = input.pausePollIntervalMs ?? TEAM_PAUSE_POLL_INTERVAL_MS;
  const maxBlockMs = input.pauseMaxBlockMs ?? TEAM_PAUSE_MAX_BLOCK_MS;

  // 用户在前端直接 stop（abortController 已 abort）优先于一切。
  if (input.signal.aborted) {
    return { kind: 'cancelled', reason: 'aborted' };
  }

  let paused = false;
  let pauseStartedAt = 0;

  for (;;) {
    if (input.signal.aborted) {
      return { kind: 'cancelled', reason: 'aborted' };
    }

    const message = consume({ toSessionId: input.sessionId, loopIteration: input.round });
    if (message) {
      const type = message.messageType as InboundControlSignalType;
      if (type === 'cancel_signal') {
        return { kind: 'cancelled', reason: controlSignalReason(message.payload, 'cancelled') };
      }
      if (type === 'pause_signal') {
        if (!paused) {
          paused = true;
          pauseStartedAt = now();
        }
        // 落到下面的阻塞轮询。
      } else if (type === 'resume_signal') {
        paused = false;
        return { kind: 'continue' };
      }
    }

    if (!paused) {
      return { kind: 'continue' };
    }

    // pause 阻塞兜底：超过最大墙钟仍未 resume → 按取消处理，释放执行槽。
    if (now() - pauseStartedAt >= maxBlockMs) {
      return { kind: 'cancelled', reason: 'pause-timeout-exceeded' };
    }

    await sleep(pollIntervalMs);
  }
}
