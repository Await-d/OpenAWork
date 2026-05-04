import type {
  PendingPermissionRequest,
  PermissionReplyPayload,
  PermissionRequestBase,
  StreamPermissionAskedChunk,
} from '@openAwork/shared';
import { HttpError } from './sessions.js';

export type {
  PendingPermissionRequest,
  PermissionDecision,
  PermissionReplyPayload,
  PermissionRequestBase,
} from '@openAwork/shared';

export type CreatePermissionRequestPayload = Omit<PermissionRequestBase, 'requestId'>;

export interface PermissionsClient {
  listPending(
    token: string,
    sessionId: string,
    options?: { signal?: AbortSignal },
  ): Promise<PendingPermissionRequest[]>;
  createRequest(
    token: string,
    sessionId: string,
    payload: CreatePermissionRequestPayload,
  ): Promise<PendingPermissionRequest>;
  reply(token: string, sessionId: string, payload: PermissionReplyPayload): Promise<void>;
}

function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

async function readJsonErrorData<T>(response: Response): Promise<T | undefined> {
  const data = (await response.json().catch(() => null)) as T | null;
  return data ?? undefined;
}

export function isPendingPermissionRequest(value: unknown): value is PendingPermissionRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  const decision = record['decision'];
  const previewAction = record['previewAction'];
  return (
    typeof record['requestId'] === 'string' &&
    typeof record['sessionId'] === 'string' &&
    typeof record['toolName'] === 'string' &&
    typeof record['scope'] === 'string' &&
    typeof record['reason'] === 'string' &&
    (record['riskLevel'] === 'low' ||
      record['riskLevel'] === 'medium' ||
      record['riskLevel'] === 'high') &&
    (record['status'] === 'pending' ||
      record['status'] === 'approved' ||
      record['status'] === 'rejected') &&
    typeof record['createdAt'] === 'string' &&
    (previewAction === undefined || typeof previewAction === 'string') &&
    (decision === undefined ||
      decision === 'once' ||
      decision === 'session' ||
      decision === 'permanent' ||
      decision === 'reject')
  );
}

export function toPendingPermissionRequests(value: unknown): PendingPermissionRequest[] {
  return Array.isArray(value) ? value.filter((item) => isPendingPermissionRequest(item)) : [];
}

export function dedupePendingPermissionRequests(
  requests: PendingPermissionRequest[],
): PendingPermissionRequest[] {
  const mergedByRequestId = new Map<string, PendingPermissionRequest>();
  const order: string[] = [];

  for (const request of requests) {
    const existing = mergedByRequestId.get(request.requestId);
    if (!existing) {
      order.push(request.requestId);
      mergedByRequestId.set(request.requestId, request);
      continue;
    }

    mergedByRequestId.set(request.requestId, { ...existing, ...request });
  }

  return order
    .map((requestId) => mergedByRequestId.get(requestId))
    .filter((request): request is PendingPermissionRequest => request !== undefined);
}

export function findFirstPendingPermission(
  requests: PendingPermissionRequest[],
): PendingPermissionRequest | null {
  return requests.find((request) => request.status === 'pending') ?? null;
}

export function createPendingPermissionRequestSnapshot(
  event: StreamPermissionAskedChunk,
  sessionId: string,
): PendingPermissionRequest {
  return {
    createdAt: new Date(event.occurredAt ?? Date.now()).toISOString(),
    decision: undefined,
    previewAction: event.previewAction,
    reason: event.reason,
    requestId: event.requestId,
    riskLevel: event.riskLevel,
    scope: event.scope,
    sessionId,
    status: 'pending',
    toolName: event.toolName,
  };
}

export function createPermissionsClient(gatewayUrl: string): PermissionsClient {
  return {
    async listPending(token, sessionId, options) {
      const res = await fetch(`${gatewayUrl}/sessions/${sessionId}/permissions/pending`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      if (!res.ok) {
        const data = await readJsonErrorData<{ error?: string }>(res);
        throw new HttpError(`Failed to list pending permissions: ${res.status}`, res.status, data);
      }
      const data = (await res.json()) as { requests?: PendingPermissionRequest[] };
      return data.requests ?? [];
    },

    async createRequest(token, sessionId, payload) {
      const res = await fetch(`${gatewayUrl}/sessions/${sessionId}/permissions/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(token) },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await readJsonErrorData<{ error?: string }>(res);
        throw new HttpError(`Failed to create permission request: ${res.status}`, res.status, data);
      }
      const data = (await res.json()) as { request: PendingPermissionRequest };
      return data.request;
    },

    async reply(token, sessionId, payload) {
      const res = await fetch(`${gatewayUrl}/sessions/${sessionId}/permissions/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(token) },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await readJsonErrorData<{ error?: string }>(res);
        throw new HttpError(`Failed to reply permission request: ${res.status}`, res.status, data);
      }
    },
  };
}
