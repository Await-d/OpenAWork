import type {
  PendingPermissionRequest,
  PermissionDecision,
  PermissionRequestStatus,
  PermissionRiskLevel,
} from '@openAwork/shared';
import { z } from 'zod';
import {
  streamRequestSchema as permissionResumeRequestSchema,
  type ApprovedPermissionResumePayload,
} from './routes/stream.js';

export type {
  PendingPermissionRequest,
  PermissionDecision,
  PermissionRequestStatus,
  PermissionRiskLevel,
} from '@openAwork/shared';

export const permissionRiskLevelSchema = z.enum(['low', 'medium', 'high']);
export const permissionDecisionSchema = z.enum(['once', 'session', 'permanent', 'reject']);

interface PermissionRequestRowLike {
  created_at: string;
  decision: PermissionDecision | null;
  id: string;
  preview_action: string | null;
  reason: string;
  risk_level: PermissionRiskLevel;
  scope: string;
  session_id: string;
  status: PermissionRequestStatus | 'consumed';
  tool_name: string;
}

export function resolvePermissionRequestTimeoutMs(): number | undefined {
  const raw = process.env['OPENAWORK_PERMISSION_REQUEST_TIMEOUT_MS'];
  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Math.floor(parsed);
}

export function mapPermissionRequestRow(
  row: PermissionRequestRowLike,
): PendingPermissionRequest | null {
  if (row.status !== 'pending' && row.status !== 'approved' && row.status !== 'rejected') {
    return null;
  }

  return {
    requestId: row.id,
    sessionId: row.session_id,
    toolName: row.tool_name,
    scope: row.scope,
    reason: row.reason,
    riskLevel: row.risk_level,
    previewAction: row.preview_action ?? undefined,
    status: row.status,
    decision: row.decision ?? undefined,
    createdAt: row.created_at,
  };
}

export function parseApprovedPermissionResumePayload(
  payloadJson: string | null,
): Omit<ApprovedPermissionResumePayload, 'toolName'> | null {
  if (!payloadJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(payloadJson) as Record<string, unknown>;
    const clientRequestId =
      typeof parsed['clientRequestId'] === 'string' ? parsed['clientRequestId'] : null;
    const toolCallId = typeof parsed['toolCallId'] === 'string' ? parsed['toolCallId'] : null;
    const nextRound = typeof parsed['nextRound'] === 'number' ? parsed['nextRound'] : null;
    const rawInput =
      parsed['rawInput'] && typeof parsed['rawInput'] === 'object'
        ? (parsed['rawInput'] as Record<string, unknown>)
        : null;
    const requestDataCandidate =
      parsed['requestData'] && typeof parsed['requestData'] === 'object'
        ? (parsed['requestData'] as Record<string, unknown>)
        : null;

    if (
      !clientRequestId ||
      !toolCallId ||
      nextRound === null ||
      !rawInput ||
      !requestDataCandidate
    ) {
      return null;
    }

    const requestData = permissionResumeRequestSchema.parse(requestDataCandidate);
    const observabilityCandidate =
      parsed['observability'] && typeof parsed['observability'] === 'object'
        ? (parsed['observability'] as Record<string, unknown>)
        : null;

    return {
      clientRequestId,
      nextRound,
      requestData,
      toolCallId,
      rawInput,
      ...(observabilityCandidate
        ? {
            observability: {
              presentedToolName:
                typeof observabilityCandidate['presentedToolName'] === 'string'
                  ? observabilityCandidate['presentedToolName']
                  : 'unknown',
              canonicalToolName:
                typeof observabilityCandidate['canonicalToolName'] === 'string'
                  ? observabilityCandidate['canonicalToolName']
                  : 'unknown',
              adapterVersion:
                typeof observabilityCandidate['adapterVersion'] === 'string'
                  ? observabilityCandidate['adapterVersion']
                  : '1.0.0',
            },
          }
        : {}),
    };
  } catch {
    return null;
  }
}

export function parsePermissionRequestClientRequestId(payloadJson: string | null): string | null {
  if (!payloadJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(payloadJson) as Record<string, unknown>;
    return typeof parsed['clientRequestId'] === 'string' ? parsed['clientRequestId'] : null;
  } catch {
    return null;
  }
}
