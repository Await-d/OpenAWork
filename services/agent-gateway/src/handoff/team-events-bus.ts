/**
 * 260515-team-phase-b · T-07
 *
 * 团队事件总线（in-process）。
 *
 * 角色：
 *   - 后端各模块（handoff store / scheduler / watcher / runtime）发布事件
 *   - WS 路由 `/team-events` 订阅并把事件信封推给前端
 *   - 前端 TeamEventDispatcher（Phase B T-11）按 type 分发到对应 store
 *
 * 信封格式（v3.11 D4 子决策 3=B 锁定的最小集，Phase B 不再扩展）：
 *
 *   {
 *     "type": "handoff.created" | "handoff.claimed" | ...,
 *     "taskId"?: string,            // handoffId
 *     "sessionId"?: string,         // 关联 session
 *     "layer"?: HandoffRoleLayer,   // 来源层
 *     "timestamp": number,          // ms
 *     "payload": Record<string,unknown>
 *   }
 *
 * 这里只做"发布订阅"，不持久化、不重放（重放走 DB 查询）。
 */

import type { HandoffRecord } from './handoff-store.js';

export type TeamEventType =
  | 'handoff.created'
  | 'handoff.claimed'
  | 'handoff.started'
  | 'handoff.completed'
  | 'handoff.failed'
  | 'handoff.cancelled'
  | 'handoff.reclaimed'
  | 'session.heartbeat'
  | 'session.substate.changed'
  | 'session.inbound.submitted'
  | 'scheduler.task-paused'
  | 'scheduler.task-resumed'
  | 'scheduler.all-paused'
  | 'scheduler.all-resumed'
  | 'artifact.needs-clarification'
  | 'artifact.constitution-conflict';

export interface TeamEventEnvelope {
  type: TeamEventType;
  taskId?: string;
  sessionId?: string;
  /**
   * 来源层级。绝大多数事件是 HandoffRoleLayer 的 6 个固定值，
   * 但 substate / inbound 事件的 layer 可能是组件级别（如 'system'），
   * 因此放宽到 string——再用 lint 同志的 union narrowing 处理也可以，
   * 但这里更简单。
   */
  layer?: string;
  timestamp: number;
  payload: Record<string, unknown>;
  /** 收件人 user_id；事件总线按此过滤订阅者。 */
  userId: string;
}

export type TeamEventListener = (event: TeamEventEnvelope) => void;

class TeamEventsBus {
  private listeners = new Set<TeamEventListener>();

  publish(event: TeamEventEnvelope): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.warn(
          `[team-events] listener threw: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  subscribe(listener: TeamEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 仅供测试 / 重启时清理用。运行时不要主动调用。
   */
  __clearForTesting(): void {
    this.listeners.clear();
  }
}

const bus = new TeamEventsBus();

export function publishTeamEvent(event: TeamEventEnvelope): void {
  bus.publish(event);
}

export function subscribeToTeamEvents(listener: TeamEventListener): () => void {
  return bus.subscribe(listener);
}

export function __clearTeamEventsBusForTesting(): void {
  bus.__clearForTesting();
}

// ─── Convenience publishers (一处写错全员错) ────────────────────────────────

export function publishHandoffEvent(input: {
  type: Extract<
    TeamEventType,
    | 'handoff.created'
    | 'handoff.claimed'
    | 'handoff.started'
    | 'handoff.completed'
    | 'handoff.failed'
    | 'handoff.cancelled'
    | 'handoff.reclaimed'
  >;
  record: HandoffRecord;
  payload?: Record<string, unknown>;
}): void {
  publishTeamEvent({
    type: input.type,
    taskId: input.record.id,
    sessionId: input.record.toSessionId ?? input.record.fromSessionId,
    layer: input.record.fromRoleLayer,
    timestamp: Date.now(),
    payload: {
      fromRoleLayer: input.record.fromRoleLayer,
      toRoleLayer: input.record.toRoleLayer,
      state: input.record.state,
      retryCount: input.record.retryCount,
      ...(input.payload ?? {}),
    },
    userId: input.record.userId,
  });
}
