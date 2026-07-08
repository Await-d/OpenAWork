/**
 * use-team-run-state · 团队会话「整体运行状态」聚合
 *
 * 背景：用户提交需求后，真正的工作发生在子会话（pm1→pm2→executor→reviewer）的
 * handoff 链路里，reception 会话本身常回到 idle，导致前端「看不出团队是在跑、卡住了、
 * 还是异常停了」。本 hook 把分散的运行信号聚合成一个明确的运行态：
 *
 *   - working    : 有活跃 handoff（pending/claimed/running），且近期有活动
 *   - failed     : 最近一次 handoff 进入 failed（需要用户关注）
 *   - completed  : 曾经跑过、当前无活跃 handoff（全部结束）
 *   - idle       : 从未开始（没有任何 handoff）
 *   - disconnected: team-events WS 断开（拿不到实时状态）
 *
 * 数据源：useHandoffStore（handoff 状态 + updatedAt）、useTeamEventsConnectionStore
 * （WS 连接态）、useTeamNotificationStore（最近事件时间，用于「最后活动」）。
 */

import { useEffect, useMemo, useState } from 'react';
import {
  useClarificationStore,
  useHandoffStore,
  useLayerStore,
  useTeamEventsConnectionStore,
  useTeamNotificationStore,
} from '../../../../stores/team/team-events.js';
import { useSessionPendingInteractionSnapshot } from '../../../../utils/session/use-session-pending-interaction-snapshot.js';
import { collectSessionScope } from '../data/team-runtime-session-scope.js';
import {
  resolvePendingInteractionCountsInScope,
  resolveSessionScopeStallState,
} from '../data/team-runtime-stall-detection.js';

export type TeamRunPhase = 'idle' | 'working' | 'failed' | 'completed' | 'disconnected';

export interface TeamRunState {
  phase: TeamRunPhase;
  /** 活跃 handoff 数（pending/claimed/running）。 */
  activeCount: number;
  /** 失败 handoff 数。 */
  failedCount: number;
  /** 已完成 handoff 数。 */
  completedCount: number;
  /** 已取消 handoff 数。 */
  cancelledCount: number;
  /** handoff 总数。 */
  totalCount: number;
  /** 最近一次活动距今的毫秒数（无活动为 null）。 */
  lastActivityAgoMs: number | null;
  /** 当前正在运行的层级（取最近活跃 handoff 的目标层）。 */
  activeLayer: string | null;
  /** 当前是否处于允许的等待态（如澄清/等待下游/待用户决策）。 */
  waitingAllowed: boolean;
}

const ACTIVE_STATES = new Set(['pending', 'claimed', 'running']);

const ACTIVITY_WINDOW_MS = 300_000;

export function useTeamRunState(input?: {
  pendingPermissionCount?: number;
  pendingQuestionCount?: number;
  pendingSessionId?: string | null;
}): TeamRunState {
  const handoffs = useHandoffStore((s) => s.handoffs);
  const nodes = useLayerStore((s) => s.nodes);
  const clarifications = useClarificationStore((s) => s.items);
  const connectionState = useTeamEventsConnectionStore((s) => s.state);
  const events = useTeamNotificationStore((s) => s.events);
  const pendingInteractionSnapshot = useSessionPendingInteractionSnapshot();

  // 每 5s 触发一次重算，让「最后活动 N 秒前」能随时间推进刷新，
  // 不依赖新事件到达。
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((v) => v + 1), 5_000);
    return () => clearInterval(timer);
  }, []);

  return useMemo(() => {
    void tick;
    const entries = Array.from(handoffs.values());
    const nodeEntries = Array.from(nodes.values());
    const totalCount = entries.length;
    const activeEntries = entries.filter((h) => ACTIVE_STATES.has(h.state));
    const failedCount = entries.filter((h) => h.state === 'failed').length;
    const completedCount = entries.filter((h) => h.state === 'completed').length;
    const cancelledCount = entries.filter((h) => h.state === 'cancelled').length;

    // 最近活动时间：取所有 handoff updatedAt 与最近事件 timestamp 的最大值。
    const handoffLatest = entries.reduce(
      (max, h) => (h.updatedAt && h.updatedAt > max ? h.updatedAt : max),
      0,
    );
    const eventLatest = events.reduce(
      (max, event) => (event.timestamp > max ? event.timestamp : max),
      0,
    );
    const latestActivity = Math.max(handoffLatest, eventLatest);
    let lastActivityAgoMs = latestActivity > 0 ? Math.max(0, Date.now() - latestActivity) : null;

    // 最近活跃 handoff 的目标层（用于「正在 X 层工作」提示）。
    const activeLayer =
      activeEntries.slice().sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]
        ?.toRoleLayer ?? null;
    const activeScopeStates = activeEntries.map((entry) => {
      const scopeRootSessionId =
        entry.sessionId ?? entry.toSessionId ?? entry.fromSessionId ?? null;
      const sessionScope = scopeRootSessionId
        ? collectSessionScope(scopeRootSessionId, nodeEntries)
        : new Set<string>();
      const scopePending = resolvePendingInteractionCountsInScope(
        pendingInteractionSnapshot,
        sessionScope,
      );
      const pendingSessionId = input?.pendingSessionId ?? null;
      const includeExtraPending =
        pendingSessionId !== null &&
        pendingSessionId.length > 0 &&
        sessionScope.has(pendingSessionId);
      return resolveSessionScopeStallState({
        clarifications,
        events,
        handoffs: entries,
        nodes: nodeEntries,
        pendingPermissionCount:
          scopePending.pendingPermissionCount +
          (includeExtraPending ? (input?.pendingPermissionCount ?? 0) : 0),
        pendingQuestionCount:
          scopePending.pendingQuestionCount +
          (includeExtraPending ? (input?.pendingQuestionCount ?? 0) : 0),
        running: true,
        sessionScope,
        thresholdMs: ACTIVITY_WINDOW_MS,
      });
    });
    const waitingAllowed = activeScopeStates.some((state) => state.waitingAllowed);

    let phase: TeamRunPhase;
    if (connectionState === 'offline' || connectionState === 'stopped') {
      phase = 'disconnected';
    } else if (activeEntries.length > 0) {
      phase = 'working';
    } else if (failedCount > 0 && completedCount === 0) {
      // 有失败且没有任何完成 → 整体失败态需要用户关注。
      phase = 'failed';
    } else if (totalCount > 0) {
      phase = 'completed';
    } else {
      phase = 'idle';
    }

    return {
      phase,
      activeCount: activeEntries.length,
      failedCount,
      completedCount,
      cancelledCount,
      totalCount,
      lastActivityAgoMs,
      activeLayer,
      waitingAllowed,
    };
  }, [
    handoffs,
    nodes,
    clarifications,
    connectionState,
    events,
    pendingInteractionSnapshot,
    tick,
    input?.pendingPermissionCount,
    input?.pendingQuestionCount,
    input?.pendingSessionId,
  ]);
}
