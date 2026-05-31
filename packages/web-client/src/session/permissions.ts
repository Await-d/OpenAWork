import type {
  PendingPermissionRequest,
  PermissionReplyPayload,
  PermissionRequestBase,
  StreamPermissionAskedChunk,
} from '@openAwork/shared';
import { HttpError } from './sessions.js';
import {
  extractJsonErrorMessage,
  isGenericFetchErrorMessage,
  type JsonErrorData,
  fetchWithTimeout,
} from '../gateway/http.js';

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

function buildPermissionsActionErrorMessage(
  actionLabel: string,
  status: number,
  data: JsonErrorData | undefined,
): string {
  const extracted = extractJsonErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return `认证失效或当前账号无权${actionLabel}。`;
  }
  if (status === 404) {
    return `目标权限请求资源不存在，无法${actionLabel}。`;
  }
  if (status === 409) {
    return `当前状态不允许${actionLabel}。`;
  }
  return `${actionLabel}失败（HTTP ${status}）。`;
}

function isGenericPermissionsNetworkErrorMessage(message: string): boolean {
  return isGenericFetchErrorMessage(message);
}

function normalizePermissionsError(actionLabel: string, error: unknown): Error {
  if (error instanceof HttpError) {
    const extracted = extractJsonErrorMessage((error.data ?? undefined) as JsonErrorData | undefined);
    if (extracted) {
      return new HttpError(extracted, error.status, error.data);
    }
    return error;
  }
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0 && !isGenericPermissionsNetworkErrorMessage(message)) {
      return error;
    }
  }
  return new Error(`网络异常，${actionLabel}失败。`);
}

async function performPermissionsRequest<T>(input: {
  actionLabel: string;
  parseJson?: boolean;
  request: () => Promise<Response>;
}): Promise<T> {
  try {
    const res = await input.request();
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as JsonErrorData | null;
      throw new HttpError(
        buildPermissionsActionErrorMessage(input.actionLabel, res.status, data ?? undefined),
        res.status,
        data ?? undefined,
      );
    }
    if (input.parseJson === false || res.status === 204) {
      return undefined as T;
    }
    return (await res.json()) as T;
  } catch (error) {
    throw normalizePermissionsError(input.actionLabel, error);
  }
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
    ...(event.always && event.always.length > 0 ? { always: event.always } : {}),
  };
}

export function createPermissionsClient(gatewayUrl: string): PermissionsClient {
  return {
    async listPending(token, sessionId, options) {
      const data = await performPermissionsRequest<{ requests?: PendingPermissionRequest[] }>({
        actionLabel: '读取待处理权限请求',
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/${sessionId}/permissions/pending`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
      return data.requests ?? [];
    },

    async createRequest(token, sessionId, payload) {
      const data = await performPermissionsRequest<{ request: PendingPermissionRequest }>({
        actionLabel: '创建权限请求',
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/${sessionId}/permissions/requests`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeader(token) },
            body: JSON.stringify(payload),
          }),
      });
      return data.request;
    },

    async reply(token, sessionId, payload) {
      await performPermissionsRequest({
        actionLabel: '回复权限请求',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/${sessionId}/permissions/reply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeader(token) },
            body: JSON.stringify(payload),
          }),
      });
    },
  };
}
