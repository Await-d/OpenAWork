import type { HandoffEvent } from '../../../stores/team/team-events.js';

/** 会让当前会话重新拉取快照的团队事件类型。 */
export const TEAM_RELOAD_EVENT_TYPES: ReadonlySet<string> = new Set([
  'session.inbound.submitted',
  'session.substate.changed',
  'session.init.changed',
  'session.messages.rolled_back',
  'handoff.started',
  'handoff.completed',
  'handoff.failed',
  'handoff.cancelled',
  'handoff.reclaimed',
]);

/**
 * 事件是否与 `sessionId` 相关。
 *
 * handoff 事件的顶层 `sessionId` 取的是 handoff 的**目标会话**
 * （`toSessionId ?? fromSessionId`，见 `team-events-bus.publishHandoffEvent`），
 * 所以「pm1 子会话 handoff 失败」这类事件的顶层 sessionId 是子会话。若只比顶层
 * 字段，正在查看接待层的会话就收不到该事件、也就不会刷新——这正是
 * 「规划失败后接待层界面看不到提示」的成因。因此还要比 payload 的两端 id。
 *
 * 回合回退事件还要比 payload 的 `affectedSessionIds`（回执里的子树）：
 * 回退发生在接待层时，正在查看子会话的视图也必须刷新。
 */
export function isTeamEventForSession(event: HandoffEvent, sessionId: string): boolean {
  if (event.sessionId === sessionId) return true;
  if (event.payload['fromSessionId'] === sessionId || event.payload['toSessionId'] === sessionId) {
    return true;
  }
  const affectedSessionIds = event.payload['affectedSessionIds'];
  return Array.isArray(affectedSessionIds) && affectedSessionIds.includes(sessionId);
}

/**
 * 本批事件里是否有任意一条需要为 `sessionId` 触发 reload。
 *
 * 必须检查整批而不是只看最后一条：同一批可能混入其它会话的事件，只看末条会
 * 整批丢弃本会话的刷新信号。`lastSeenTimestamp` 是处理水位，只处理更新的。
 */
export function shouldReloadForTeamEvents(input: {
  events: readonly HandoffEvent[];
  sessionId: string;
  lastSeenTimestamp: number;
}): boolean {
  return input.events.some(
    (event) =>
      event.timestamp > input.lastSeenTimestamp &&
      TEAM_RELOAD_EVENT_TYPES.has(event.type) &&
      // 幂等重放的空操作回执没有改变任何服务端状态，不构成刷新理由。
      !(event.type === 'session.messages.rolled_back' && event.payload['applied'] === false) &&
      isTeamEventForSession(event, input.sessionId),
  );
}

/** 推进处理水位到本批最大 timestamp（批内可能乱序，不能取末条）。 */
export function nextTeamEventWatermark(
  events: readonly HandoffEvent[],
  lastSeenTimestamp: number,
): number {
  return events.reduce((max, event) => Math.max(max, event.timestamp), lastSeenTimestamp);
}
