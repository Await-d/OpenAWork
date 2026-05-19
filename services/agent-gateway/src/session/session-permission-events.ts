import type { InteractionRecord, RunEvent } from '@openAwork/shared';
import {
  parsePermissionAlwaysJson,
  type PermissionDecision,
  type PermissionRequestStatus,
  type PermissionRiskLevel,
} from '../permission/permission-contract.js';
import { sqliteAll } from '../infra/db.js';

interface PermissionRequestEventRow {
  id: string;
  session_id: string;
  tool_name: string;
  scope: string;
  reason: string;
  risk_level: PermissionRiskLevel;
  preview_action: string | null;
  always_json: string | null;
  status: PermissionRequestStatus | 'consumed';
  decision: PermissionDecision | null;
  created_at: string;
  updated_at: string;
}

export function createPermissionAskedEvent(input: {
  always?: string[];
  occurredAt?: number;
  previewAction?: string;
  reason: string;
  requestId: string;
  riskLevel: PermissionRiskLevel;
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
    ...(input.always && input.always.length > 0 ? { always: input.always } : {}),
    eventId: `permission:${input.requestId}:asked`,
    runId: `permission:${input.requestId}`,
    occurredAt: input.occurredAt ?? Date.now(),
  };
}

export function createPermissionRepliedEvent(input: {
  decision: PermissionDecision;
  feedback?: string;
  occurredAt?: number;
  requestId: string;
}): Extract<RunEvent, { type: 'permission_replied' }> {
  return {
    type: 'permission_replied',
    requestId: input.requestId,
    decision: input.decision,
    ...(input.feedback ? { feedback: input.feedback } : {}),
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
  riskLevel: PermissionRiskLevel;
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
    `SELECT id, session_id, tool_name, scope, reason, risk_level, preview_action, always_json, status, decision, created_at, updated_at
     FROM permission_requests
     WHERE session_id = ?
     ORDER BY created_at ASC`,
    [sessionId],
  );

  return rows.flatMap((row) => {
    const alwaysPatterns = parsePermissionAlwaysJson(row.always_json);
    const events: RunEvent[] = [
      createPermissionAskedEvent({
        requestId: row.id,
        toolName: row.tool_name,
        scope: row.scope,
        reason: row.reason,
        riskLevel: row.risk_level,
        previewAction: row.preview_action ?? undefined,
        ...(alwaysPatterns.length > 0 ? { always: alwaysPatterns } : {}),
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
