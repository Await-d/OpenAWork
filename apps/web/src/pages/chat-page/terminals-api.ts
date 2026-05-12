/**
 * Client-side wrapper around `/sessions/:sessionId/terminals` routes.
 * The backend contract lives in
 * `services/agent-gateway/src/routes/session-terminals.ts` and
 * the shared types in `@openAwork/shared`.
 */

import type { SessionTerminalSummary } from '@openAwork/shared';

export type SessionTerminalView = SessionTerminalSummary;

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let body: string;
    try {
      body = await response.text();
    } catch {
      body = '';
    }
    throw new Error(`HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
  return (await response.json()) as T;
}

export interface ListSessionTerminalsParams {
  gatewayUrl: string;
  sessionId: string;
  token: string;
  /** When 'running' the API returns only running rows. Defaults to all. */
  status?: 'running' | 'all';
  limit?: number;
  signal?: AbortSignal;
}

export async function listSessionTerminals(
  params: ListSessionTerminalsParams,
): Promise<{ terminals: SessionTerminalView[] }> {
  const url = new URL(`${params.gatewayUrl}/sessions/${params.sessionId}/terminals`);
  if (params.status) url.searchParams.set('status', params.status);
  if (params.limit !== undefined) url.searchParams.set('limit', String(params.limit));
  const headers: Record<string, string> = { Authorization: `Bearer ${params.token}` };
  const init: RequestInit = { headers };
  if (params.signal) init.signal = params.signal;
  const response = await fetch(url.toString(), init);
  return parseJsonResponse(response);
}

export interface KillSessionTerminalParams {
  gatewayUrl: string;
  sessionId: string;
  terminalId: string;
  token: string;
  signal?: AbortSignal;
}

export async function killSessionTerminal(params: KillSessionTerminalParams): Promise<{
  result: { found: boolean; alreadyClosed: boolean; killed: boolean };
  terminal: SessionTerminalView | null;
}> {
  const headers: Record<string, string> = { Authorization: `Bearer ${params.token}` };
  const init: RequestInit = { method: 'POST', headers };
  if (params.signal) init.signal = params.signal;
  const response = await fetch(
    `${params.gatewayUrl}/sessions/${params.sessionId}/terminals/${params.terminalId}/kill`,
    init,
  );
  return parseJsonResponse(response);
}

export interface DeleteSessionTerminalParams extends KillSessionTerminalParams {}

export async function deleteSessionTerminal(
  params: DeleteSessionTerminalParams,
): Promise<{ deleted: boolean }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${params.token}` };
  const init: RequestInit = { method: 'DELETE', headers };
  if (params.signal) init.signal = params.signal;
  const response = await fetch(
    `${params.gatewayUrl}/sessions/${params.sessionId}/terminals/${params.terminalId}`,
    init,
  );
  return parseJsonResponse(response);
}
