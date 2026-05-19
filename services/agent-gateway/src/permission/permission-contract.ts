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
} from '../routes/stream.js';

export type {
  PendingPermissionRequest,
  PermissionDecision,
  PermissionRequestStatus,
  PermissionRiskLevel,
} from '@openAwork/shared';

export const permissionRiskLevelSchema = z.enum(['low', 'medium', 'high']);
export const permissionDecisionSchema = z.enum(['once', 'session', 'permanent', 'reject']);

interface PermissionRequestRowLike {
  always_json?: string | null;
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

/**
 * Parse the `always_json` column on `permission_requests`.
 *
 * The column stores the `PermissionRequestContext.always` array built at
 * request time (e.g. `["ls *"]` for `bash ls -la`). When the user approves
 * with decision `session` or `permanent`, those patterns are the broad
 * approval scopes opencode-style ctx.ask uses to suppress re-prompting on
 * subsequent same-category invocations (see
 * `@/temp/opencode/packages/opencode/src/permission/index.ts` ask handler).
 *
 * Returns `[]` when the JSON is missing or malformed. Callers that want a
 * fallback (legacy rows persisted before the column existed) must supply
 * one explicitly — e.g. routes/permissions.ts falls back to the original
 * request scope, while the approval matcher prefers exact/scope-glob over
 * silently widening to "*".
 */
export function parsePermissionAlwaysJson(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (value): value is string => typeof value === 'string' && value.length > 0,
      );
    }
  } catch {
    // fall through to empty array
  }
  return [];
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

  const alwaysPatterns = parsePermissionAlwaysJson(row.always_json ?? null);

  return {
    requestId: row.id,
    sessionId: row.session_id,
    toolName: row.tool_name,
    scope: row.scope,
    reason: row.reason,
    riskLevel: row.risk_level,
    previewAction: row.preview_action ?? undefined,
    ...(alwaysPatterns.length > 0 ? { always: alwaysPatterns } : {}),
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
