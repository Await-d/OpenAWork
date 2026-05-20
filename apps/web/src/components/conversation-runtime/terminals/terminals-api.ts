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

export interface RenameSessionTerminalParams {
  gatewayUrl: string;
  sessionId: string;
  terminalId: string;
  token: string;
  name: string | null;
  signal?: AbortSignal;
}

export async function renameSessionTerminal(
  params: RenameSessionTerminalParams,
): Promise<{ renamed: boolean; terminal: SessionTerminalView | null }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${params.token}`,
    'Content-Type': 'application/json',
  };
  const init: RequestInit = {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ name: params.name }),
  };
  if (params.signal) init.signal = params.signal;
  const response = await fetch(
    `${params.gatewayUrl}/sessions/${params.sessionId}/terminals/${params.terminalId}`,
    init,
  );
  return parseJsonResponse(response);
}

/* ---------------------------------------------------------------------- */
/* Persistent / interactive terminal helpers (阶段 1)                      */
/* ---------------------------------------------------------------------- */

export interface CreateSessionTerminalParams {
  gatewayUrl: string;
  sessionId: string;
  token: string;
  cwd?: string;
  initialCommand?: string;
  description?: string;
  signal?: AbortSignal;
}

/**
 * Spawn a new user-driven persistent terminal. Backend emits a
 * `terminal_started` RunEvent that `useSessionTerminals` will pick up
 * automatically — but the response also returns the row so callers can
 * activate the new tab synchronously without waiting for the event.
 */
export async function createSessionTerminal(
  params: CreateSessionTerminalParams,
): Promise<{ terminal: SessionTerminalView }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${params.token}`,
    'Content-Type': 'application/json',
  };
  const init: RequestInit = {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...(params.cwd ? { cwd: params.cwd } : {}),
      ...(params.initialCommand ? { initialCommand: params.initialCommand } : {}),
      ...(params.description ? { description: params.description } : {}),
    }),
  };
  if (params.signal) init.signal = params.signal;
  const response = await fetch(`${params.gatewayUrl}/sessions/${params.sessionId}/terminals`, init);
  return parseJsonResponse(response);
}

export interface WriteTerminalStdinParams {
  gatewayUrl: string;
  sessionId: string;
  terminalId: string;
  token: string;
  data: string;
  signal?: AbortSignal;
}

export async function writeTerminalStdin(
  params: WriteTerminalStdinParams,
): Promise<{ ok: boolean; error?: string }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${params.token}`,
    'Content-Type': 'application/json',
  };
  const init: RequestInit = {
    method: 'POST',
    headers,
    body: JSON.stringify({ data: params.data }),
  };
  if (params.signal) init.signal = params.signal;
  const response = await fetch(
    `${params.gatewayUrl}/sessions/${params.sessionId}/terminals/${params.terminalId}/stdin`,
    init,
  );
  return parseJsonResponse(response);
}

export interface ResizeTerminalParams {
  gatewayUrl: string;
  sessionId: string;
  terminalId: string;
  token: string;
  cols: number;
  rows: number;
  signal?: AbortSignal;
}

export async function resizeTerminal(params: ResizeTerminalParams): Promise<{ ok: boolean }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${params.token}`,
    'Content-Type': 'application/json',
  };
  const init: RequestInit = {
    method: 'POST',
    headers,
    body: JSON.stringify({ cols: params.cols, rows: params.rows }),
  };
  if (params.signal) init.signal = params.signal;
  const response = await fetch(
    `${params.gatewayUrl}/sessions/${params.sessionId}/terminals/${params.terminalId}/resize`,
    init,
  );
  return parseJsonResponse(response);
}

export interface CloseTerminalParams {
  gatewayUrl: string;
  sessionId: string;
  terminalId: string;
  token: string;
  signal?: AbortSignal;
}

export async function closeTerminal(params: CloseTerminalParams): Promise<{ ok: boolean }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${params.token}` };
  const init: RequestInit = { method: 'POST', headers };
  if (params.signal) init.signal = params.signal;
  const response = await fetch(
    `${params.gatewayUrl}/sessions/${params.sessionId}/terminals/${params.terminalId}/close`,
    init,
  );
  return parseJsonResponse(response);
}

export interface OpenTerminalStreamParams {
  gatewayUrl: string;
  sessionId: string;
  terminalId: string;
  token: string;
  onSnapshot?: (snapshot: {
    terminalId: string;
    outputTail: string;
    outputBytesTotal: number;
    status: string;
  }) => void;
  onOutput?: (chunk: { outputTail: string; outputBytesTotal: number }) => void;
  onExited?: (chunk: { status: string; exitCode?: number }) => void;
  onError?: (error: Error) => void;
}

/**
 * Build the SSE URL for a single terminal. Returns the connected
 * EventSource so the caller can `close()` it on unmount.
 */
export function openTerminalStream(params: OpenTerminalStreamParams): EventSource {
  const url = new URL(
    `${params.gatewayUrl}/sessions/${params.sessionId}/terminals/${params.terminalId}/stream`,
  );
  url.searchParams.set('token', params.token);
  const source = new EventSource(url.toString());

  source.addEventListener('snapshot', (event) => {
    try {
      const data = JSON.parse((event as MessageEvent).data) as {
        terminalId: string;
        outputTail: string;
        outputBytesTotal: number;
        status: string;
      };
      params.onSnapshot?.(data);
    } catch (error) {
      params.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  });
  source.addEventListener('output', (event) => {
    try {
      const data = JSON.parse((event as MessageEvent).data) as {
        outputTail: string;
        outputBytesTotal: number;
      };
      params.onOutput?.(data);
    } catch (error) {
      params.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  });
  source.addEventListener('exited', (event) => {
    try {
      const data = JSON.parse((event as MessageEvent).data) as {
        status: string;
        exitCode?: number;
      };
      params.onExited?.(data);
    } catch (error) {
      params.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  });
  source.addEventListener('error', () => {
    // EventSource auto-reconnects; surface only persistent failures.
    if (source.readyState === EventSource.CLOSED) {
      params.onError?.(new Error('terminal stream closed'));
    }
  });
  return source;
}
