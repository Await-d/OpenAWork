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

import type { HandoffRecord } from '../store/handoff-store.js';
import { isRecoverableFailedHandoff } from '../store/handoff-store.js';
import { recordTeamRuntimeIncident } from '../../team/team-runtime-diagnostics-store.js';

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
  | 'session.init.changed'
  | 'scheduler.task-paused'
  | 'scheduler.task-resumed'
  | 'scheduler.all-paused'
  | 'scheduler.all-resumed'
  | 'artifact.needs-clarification'
  | 'artifact.constitution-conflict'
  | 'agent.hallucination-detected'
  | 'agent.diagnostic-alert';

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

export interface TeamEventsBusStats {
  listenerCount: number;
  listenerErrorCount: number;
  publishedByType: Partial<Record<TeamEventType, number>>;
  publishedCount: number;
}

class TeamEventsBus {
  private listeners = new Set<TeamEventListener>();
  private listenerErrorCount = 0;
  private publishedByType: Partial<Record<TeamEventType, number>> = {};
  private publishedCount = 0;

  publish(event: TeamEventEnvelope): void {
    this.publishedCount += 1;
    this.publishedByType[event.type] = (this.publishedByType[event.type] ?? 0) + 1;
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        this.listenerErrorCount += 1;
        recordTeamRuntimeIncident({
          category: 'team_events_listener',
          code: 'team-events-listener-threw',
          context: {
            eventType: event.type,
            listenerCount: this.listeners.size,
          },
          message: err instanceof Error ? err.message : String(err),
          severity: 'warning',
          timestamp: Date.now(),
          userId: event.userId,
        });
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

  stats(): TeamEventsBusStats {
    return {
      listenerCount: this.listeners.size,
      listenerErrorCount: this.listenerErrorCount,
      publishedByType: { ...this.publishedByType },
      publishedCount: this.publishedCount,
    };
  }

  /**
   * 仅供测试 / 重启时清理用。运行时不要主动调用。
   */
  __clearForTesting(): void {
    this.listeners.clear();
    this.listenerErrorCount = 0;
    this.publishedByType = {};
    this.publishedCount = 0;
  }
}

const bus = new TeamEventsBus();

export function publishTeamEvent(event: TeamEventEnvelope): void {
  bus.publish(event);
}

export function subscribeToTeamEvents(listener: TeamEventListener): () => void {
  return bus.subscribe(listener);
}

export function getTeamEventsBusStats(): TeamEventsBusStats {
  return bus.stats();
}

export function __clearTeamEventsBusForTesting(): void {
  bus.__clearForTesting();
}

// ─── Convenience publishers (一处写错全员错) ────────────────────────────────

/**
 * 从 handoff record 的持久化 payload 中提取任务摘要。
 *
 * 不同创建路径存入的 key 不同：
 *   - reception→pm1：rewrittenIntent / sourceIntent / recommendedNextStep
 *   - pm2→executor/reviewer：goal（DispatchPackage 的任务目标字段）
 *
 * 统一提取为 summary 字段推送给前端，使任务清单能显示有区分度的标题。
 */
function extractSummaryFromRecordPayload(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  for (const key of ['goal', 'rewrittenIntent', 'sourceIntent', 'recommendedNextStep', 'summary']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      const trimmed = value.trim();
      // 截断过长的摘要，避免 WS 事件 payload 膨胀
      return trimmed.length > 200 ? trimmed.slice(0, 200) : trimmed;
    }
  }
  return undefined;
}

function readBoundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function readAssignedMemberEventPayload(payload: unknown): Record<string, string> | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return undefined;
  }
  const assignedMember = (payload as Record<string, unknown>)['assignedMember'];
  if (
    typeof assignedMember !== 'object' ||
    assignedMember === null ||
    Array.isArray(assignedMember)
  ) {
    return undefined;
  }
  const record = assignedMember as Record<string, unknown>;
  const eventPayload: Record<string, string> = {};
  const id = readBoundedString(record['id'], 120);
  const displayName = readBoundedString(record['displayName'], 200);
  const personaKey = readBoundedString(record['personaKey'], 160);
  const specialty = readBoundedString(record['specialty'], 80);
  if (id) eventPayload['id'] = id;
  if (displayName) eventPayload['displayName'] = displayName;
  if (personaKey) eventPayload['personaKey'] = personaKey;
  if (specialty) eventPayload['specialty'] = specialty;
  return Object.keys(eventPayload).length > 0 ? eventPayload : undefined;
}

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
  const recoverableFailure =
    input.record.state === 'failed'
      ? isRecoverableFailedHandoff({
          failureReason: input.record.failureReason,
          payload: input.record.payload,
          toRoleLayer: input.record.toRoleLayer,
        })
      : undefined;
  const assignedMember = readAssignedMemberEventPayload(input.record.payload);
  // 从 handoff record 的持久化 payload 中提取任务摘要字段，推送给前端。
  // record.payload 包含 reception-orchestrator 传入的 rewrittenIntent / sourceIntent，
  // 或 PM2 DispatchPackage 的 goal —— 这些是任务清单标题的唯一来源。
  // 如果不在每个事件中都带上，前端只能在 handoff.created 时获取到（且仅当 caller
  // 额外传了 input.payload 时），后续 claimed/started/completed 事件全丢失。
  const summaryFromPayload = extractSummaryFromRecordPayload(input.record.payload);
  publishTeamEvent({
    type: input.type,
    taskId: input.record.id,
    sessionId: input.record.toSessionId ?? input.record.fromSessionId,
    layer: input.record.fromRoleLayer,
    timestamp: Date.now(),
    payload: {
      fromRoleLayer: input.record.fromRoleLayer,
      toRoleLayer: input.record.toRoleLayer,
      fromSessionId: input.record.fromSessionId,
      toSessionId: input.record.toSessionId,
      state: input.record.state,
      retryCount: input.record.retryCount,
      ...(input.record.failureReason ? { reason: input.record.failureReason } : {}),
      ...(recoverableFailure !== undefined ? { recoverableFailure } : {}),
      ...(assignedMember ? { assignedMember } : {}),
      ...(summaryFromPayload ? { summary: summaryFromPayload } : {}),
      ...(input.payload ?? {}),
    },
    userId: input.record.userId,
  });
}

/**
 * 发布幻觉检测事件（参考 hermes-agent v0.13.0）。
 *
 * 当 DAG 节点声称完成但系统检测到输出不真实时触发。
 */
export function publishHallucinationEvent(input: {
  userId: string;
  sessionId: string;
  nodeId: string;
  issues: Array<{ type: string; detail: string }>;
}): void {
  publishTeamEvent({
    type: 'agent.hallucination-detected',
    sessionId: input.sessionId,
    timestamp: Date.now(),
    payload: {
      nodeId: input.nodeId,
      issues: input.issues,
    },
    userId: input.userId,
  });
}

/**
 * 发布诊断告警事件（参考 hermes-agent v0.13.0 通用诊断引擎）。
 *
 * 当诊断引擎检测到任务异常模式（重复失败、超时模式等）时触发。
 */
export function publishDiagnosticAlertEvent(input: {
  userId: string;
  sessionId: string;
  nodeId: string;
  pattern: string;
  detail: string;
}): void {
  publishTeamEvent({
    type: 'agent.diagnostic-alert',
    sessionId: input.sessionId,
    timestamp: Date.now(),
    payload: {
      nodeId: input.nodeId,
      pattern: input.pattern,
      detail: input.detail,
    },
    userId: input.userId,
  });
}
