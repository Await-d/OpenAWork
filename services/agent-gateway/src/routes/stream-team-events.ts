/**
 * 260518-team-tabs-data · stream → team-events 桥接
 *
 * 当 stream 完成一轮 LLM 调用（有 usage）或完成一次 tool 执行时，
 * 额外把 usage / tool_call / timing 事件发到 team-events 总线，
 * 让前端 team-usage / team-tool-call store 能实时聚合。
 *
 * 只对 team session（roleLayer != null）生效；chat 端单会话不触发。
 *
 * 关联文档：
 *   - apps/web/src/stores/team-usage.ts（前端 store schema）
 *   - apps/web/src/pages/team/runtime/tabs/metrics/（UI 消费方）
 */

import { publishTeamEvent } from '../handoff/bus/team-events-bus.js';
import {
  persistTeamTimingRecord,
  persistTeamToolCallRecord,
  persistTeamUsageRecord,
} from '../team/team-usage-records-store.js';
import type { SessionStreamContext } from './stream.js';

function _parseTeamWorkspaceId(metadataJson: string): string | null {
  try {
    const parsed = JSON.parse(metadataJson) as Record<string, unknown>;
    return typeof parsed['teamWorkspaceId'] === 'string' ? parsed['teamWorkspaceId'] : null;
  } catch {
    return null;
  }
}

// ─── Usage Event ────────────────────────────────────────────────────────────

export interface TeamUsageEventInput {
  userId: string;
  sessionId: string;
  sessionContext: SessionStreamContext;
  round: number;
  agentId?: string;
  provider?: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** 估算成本 USD（可选，由调用方按 price-per-million 计算） */
  costUsd?: number;
}

export function publishTeamUsageEvent(input: TeamUsageEventInput): void {
  if (!input.sessionContext.roleLayer) return;
  // 持久化（落库）——让刷新/重连后"度量"tab 仍能看到历史用量，不再只活在内存。
  persistTeamUsageRecord({
    userId: input.userId,
    sessionId: input.sessionId,
    layer: input.sessionContext.roleLayer,
    agentId: input.agentId ?? null,
    provider: input.provider ?? null,
    model: input.model ?? null,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    reasoningTokens: input.reasoningTokens ?? 0,
    cacheReadTokens: input.cacheReadTokens ?? 0,
    cacheWriteTokens: input.cacheWriteTokens ?? 0,
    costUsd: input.costUsd ?? 0,
  });
  publishTeamEvent({
    type: 'session.substate.changed', // 复用已有 event type 不行——需要新 type
    sessionId: input.sessionId,
    layer: input.sessionContext.roleLayer,
    timestamp: Date.now(),
    userId: input.userId,
    payload: {
      __teamEventKind: 'team_usage',
      sessionId: input.sessionId,
      agentId: input.agentId ?? null,
      provider: input.provider ?? null,
      model: input.model ?? null,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      reasoningTokens: input.reasoningTokens ?? 0,
      cacheReadTokens: input.cacheReadTokens ?? 0,
      cacheWriteTokens: input.cacheWriteTokens ?? 0,
      costUsd: input.costUsd ?? 0,
      round: input.round,
    },
  });
}

// ─── Workflow (non-stream) Usage Event ──────────────────────────────────────

/**
 * 轻量版用量事件发布器，给「非流式 workflow LLM」路径用
 * （reception 路由/改写、PM1 spec/plan/tasks、PM2 constitution/dispatch/quality
 * review 等都走 requestWorkflowLlmCompletion，而不经过 stream.ts）。
 *
 * 与 `publishTeamUsageEvent` 的区别：这些调用方手上没有完整 `SessionStreamContext`，
 * 只知道自己属于哪一层（reception/pm1/pm2/...）。本函数只要 userId + sessionId + layer
 * + usage 字段即可发出与 stream 路径同构的 `team_usage` 事件，让前端 useTeamUsageStore
 * 一视同仁地聚合——不再漏统计这几层的 token / 费用 / 调用次数。
 */
export interface TeamWorkflowUsageEventInput {
  userId: string;
  sessionId: string;
  /** 角色层级（reception/pm1/pm2/executor/reviewer 等）。空则不发。 */
  layer: string | null | undefined;
  agentId?: string | null;
  provider?: string | null;
  model?: string | null;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number;
}

export function publishTeamWorkflowUsageEvent(input: TeamWorkflowUsageEventInput): void {
  if (!input.layer) return;
  // 没有任何 token 的调用（例如纯缓存命中或异常返回）不发，避免噪声。
  if (input.inputTokens <= 0 && input.outputTokens <= 0) return;
  // 与 stream 路径一致地落库，让 reception / pm1 / pm2 的用量也能跨刷新 / 重连存活
  // （persistTeamUsageRecord 内部对全 0 token 行有自己的护栏）。
  persistTeamUsageRecord({
    userId: input.userId,
    sessionId: input.sessionId,
    layer: input.layer,
    agentId: input.agentId ?? null,
    provider: input.provider ?? null,
    model: input.model ?? null,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    reasoningTokens: input.reasoningTokens ?? 0,
    cacheReadTokens: input.cacheReadTokens ?? 0,
    cacheWriteTokens: input.cacheWriteTokens ?? 0,
    costUsd: input.costUsd ?? 0,
  });
  publishTeamEvent({
    type: 'session.substate.changed',
    sessionId: input.sessionId,
    layer: input.layer,
    timestamp: Date.now(),
    userId: input.userId,
    payload: {
      __teamEventKind: 'team_usage',
      sessionId: input.sessionId,
      agentId: input.agentId ?? null,
      provider: input.provider ?? null,
      model: input.model ?? null,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      reasoningTokens: input.reasoningTokens ?? 0,
      cacheReadTokens: input.cacheReadTokens ?? 0,
      cacheWriteTokens: input.cacheWriteTokens ?? 0,
      costUsd: input.costUsd ?? 0,
    },
  });
}

// ─── Tool Call Event ────────────────────────────────────────────────────────

export interface TeamToolCallEventInput {
  userId: string;
  sessionId: string;
  sessionContext: SessionStreamContext;
  toolName: string;
  durationMs: number;
  success: boolean;
  errorMessage?: string;
}

export function publishTeamToolCallEvent(input: TeamToolCallEventInput): void {
  if (!input.sessionContext.roleLayer) return;
  // 持久化工具调用计数（成功 / 失败），让刷新后仍能统计。
  persistTeamToolCallRecord({
    userId: input.userId,
    sessionId: input.sessionId,
    layer: input.sessionContext.roleLayer,
    success: input.success,
  });
  publishTeamEvent({
    type: 'session.substate.changed', // 同上
    sessionId: input.sessionId,
    layer: input.sessionContext.roleLayer,
    timestamp: Date.now(),
    userId: input.userId,
    payload: {
      __teamEventKind: 'team_tool_call',
      sessionId: input.sessionId,
      toolName: input.toolName,
      durationMs: input.durationMs,
      success: input.success,
      errorMessage: input.errorMessage ?? null,
    },
  });
}

// ─── Timing Event ───────────────────────────────────────────────────────────

export interface TeamTimingEventInput {
  userId: string;
  sessionId: string;
  sessionContext: SessionStreamContext;
  round: number;
  /** 从 stream 开始到第一个 token 的延迟（ms） */
  firstTokenMs?: number;
  /** 整轮 LLM 调用总耗时（ms） */
  totalMs: number;
  model?: string;
  provider?: string;
}

export function publishTeamTimingEvent(input: TeamTimingEventInput): void {
  if (!input.sessionContext.roleLayer) return;
  // 持久化耗时：累加到同一聚合行的 total_duration_ms（不增加 call_count，
  // 避免与 usage 端对同一轮重复计 LLM 调用次数）。
  persistTeamTimingRecord({
    userId: input.userId,
    sessionId: input.sessionId,
    layer: input.sessionContext.roleLayer,
    provider: input.provider ?? null,
    model: input.model ?? null,
    durationMs: input.totalMs,
  });
  publishTeamEvent({
    type: 'session.substate.changed', // 同上
    sessionId: input.sessionId,
    layer: input.sessionContext.roleLayer,
    timestamp: Date.now(),
    userId: input.userId,
    payload: {
      __teamEventKind: 'team_timing',
      sessionId: input.sessionId,
      round: input.round,
      firstTokenMs: input.firstTokenMs ?? null,
      totalMs: input.totalMs,
      model: input.model ?? null,
      provider: input.provider ?? null,
    },
  });
}
