import { HttpError } from './sessions.js';

export type PermissionDecision = 'once' | 'session' | 'permanent' | 'reject';

export interface PendingPermissionRequest {
  requestId: string;
  sessionId: string;
  toolName: string;
  scope: string;
  reason: string;
  riskLevel: 'low' | 'medium' | 'high';
  previewAction?: string;
  status: 'pending' | 'approved' | 'rejected';
  decision?: PermissionDecision;
  createdAt: string;
}

export interface PermissionsClient {
  listPending(
    token: string,
    sessionId: string,
    options?: { signal?: AbortSignal },
  ): Promise<PendingPermissionRequest[]>;
  createRequest(
    token: string,
    sessionId: string,
    payload: {
      toolName: string;
      scope: string;
      reason: string;
      riskLevel: 'low' | 'medium' | 'high';
      previewAction?: string;
    },
  ): Promise<PendingPermissionRequest>;
  reply(
    token: string,
    sessionId: string,
    payload: { requestId: string; decision: PermissionDecision },
  ): Promise<void>;
}

function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

async function readJsonErrorData<T>(response: Response): Promise<T | undefined> {
  const data = (await response.json().catch(() => null)) as T | null;
  return data ?? undefined;
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
