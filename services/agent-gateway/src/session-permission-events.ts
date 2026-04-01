import type { InteractionRecord, RunEvent } from '@openAwork/shared';
import { sqliteAll } from './db.js';

interface PermissionRequestEventRow {
  id: string;
  session_id: string;
  tool_name: string;
  scope: string;
  reason: string;
  risk_level: 'low' | 'medium' | 'high';
  preview_action: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'consumed';
  decision: 'once' | 'session' | 'permanent' | 'reject' | null;
  created_at: string;
  updated_at: string;
}

export function createPermissionAskedEvent(input: {
  occurredAt?: number;
  previewAction?: string;
  reason: string;
  requestId: string;
  riskLevel: 'low' | 'medium' | 'high';
  scope: string;
  toolName: string;
}): Extract<RunEvent, { type: 'permission_asked' }> {
  return {
    type: 'permission_asked',
    requestId: input.requestId,
    toolName: input.toolName,
    scope: input.scope,
    reason: input.reason,
    riskLevel: input.riskLevel,
    ...(input.previewAction ? { previewAction: input.previewAction } : {}),
    eventId: `permission:${input.requestId}:asked`,
    runId: `permission:${input.requestId}`,
    occurredAt: input.occurredAt ?? Date.now(),
  };
}

export function createPermissionRepliedEvent(input: {
  decision: 'once' | 'session' | 'permanent' | 'reject';
  occurredAt?: number;
  requestId: string;
}): Extract<RunEvent, { type: 'permission_replied' }> {
  return {
    type: 'permission_replied',
    requestId: input.requestId,
    decision: input.decision,
    eventId: `permission:${input.requestId}:replied`,
    runId: `permission:${input.requestId}`,
    occurredAt: input.occurredAt ?? Date.now(),
  };
}

export function createPermissionInteractionRecord(input: {
  channel?: InteractionRecord['channel'];
  decision?: 'approved' | 'rejected';
  feedback?: string;
  interactionId: string;
  requestId: string;
  runId?: string;
  status: InteractionRecord['status'];
  toolCallRef?: string;
  toolName: string;
  reason: string;
  riskLevel: 'low' | 'medium' | 'high';
  scope: string;
  previewAction?: string;
}): InteractionRecord {
  return {
    interactionId: input.interactionId,
    runId: input.runId ?? `permission:${input.requestId}`,
    type: 'permission',
    ...(input.toolCallRef ? { toolCallRef: input.toolCallRef } : {}),
    channel: input.channel ?? 'api',
    payload: {
      toolName: input.toolName,
      scope: input.scope,
      reason: input.reason,
      riskLevel: input.riskLevel,
      ...(input.previewAction ? { previewAction: input.previewAction } : {}),
    },
    ...(input.feedback ? { feedback: input.feedback } : {}),
    ...(input.decision ? { decision: input.decision } : {}),
    status: input.status,
  };
}

export function listSessionPermissionRunEvents(sessionId: string): RunEvent[] {
  const rows = sqliteAll<PermissionRequestEventRow>(
    `SELECT id, session_id, tool_name, scope, reason, risk_level, preview_action, status, decision, created_at, updated_at
     FROM permission_requests
     WHERE session_id = ?
     ORDER BY created_at ASC`,
    [sessionId],
  );

  return rows.flatMap((row) => {
    const events: RunEvent[] = [
      createPermissionAskedEvent({
        requestId: row.id,
        toolName: row.tool_name,
        scope: row.scope,
        reason: row.reason,
        riskLevel: row.risk_level,
        previewAction: row.preview_action ?? undefined,
        occurredAt: normalizeTimestamp(row.created_at),
      }),
    ];

    if (row.status !== 'pending' && row.decision) {
      events.push(
        createPermissionRepliedEvent({
          requestId: row.id,
          decision: row.decision,
          occurredAt: normalizeTimestamp(row.updated_at),
        }),
      );
    }

    return events;
  });
}

function normalizeTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}
