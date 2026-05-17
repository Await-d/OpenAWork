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

import { publishTeamEvent } from '../handoff/team-events-bus.js';
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
