/**
 * Client-side wrapper around `/sessions/:sessionId/terminals` routes.
 * The backend contract lives in
 * `services/agent-gateway/src/routes/session-terminals.ts` and
 * the shared types in `@openAwork/shared`.
 */

import { createSessionTerminalsClient } from '@openAwork/web-client';
import type { SessionTerminalView } from '@openAwork/web-client';
export type { SessionTerminalView } from '@openAwork/web-client';

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
  return createSessionTerminalsClient(params.gatewayUrl).list(params.token, params.sessionId, {
    status: params.status,
    limit: params.limit,
    signal: params.signal,
  });
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
  return createSessionTerminalsClient(params.gatewayUrl).kill(
    params.token,
    params.sessionId,
    params.terminalId,
    { signal: params.signal },
  );
}

export interface DeleteSessionTerminalParams extends KillSessionTerminalParams {}

export async function deleteSessionTerminal(
  params: DeleteSessionTerminalParams,
): Promise<{ deleted: boolean }> {
  return createSessionTerminalsClient(params.gatewayUrl).remove(
    params.token,
    params.sessionId,
    params.terminalId,
    { signal: params.signal },
  );
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
  return createSessionTerminalsClient(params.gatewayUrl).rename(
    params.token,
    params.sessionId,
    params.terminalId,
    {
      name: params.name,
      signal: params.signal,
    },
  );
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
  return createSessionTerminalsClient(params.gatewayUrl).create(params.token, params.sessionId, {
    cwd: params.cwd,
    initialCommand: params.initialCommand,
    description: params.description,
    signal: params.signal,
  });
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
  return createSessionTerminalsClient(params.gatewayUrl).writeStdin(
    params.token,
    params.sessionId,
    params.terminalId,
    {
      data: params.data,
      signal: params.signal,
    },
  );
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
  return createSessionTerminalsClient(params.gatewayUrl).resize(
    params.token,
    params.sessionId,
    params.terminalId,
    {
      cols: params.cols,
      rows: params.rows,
      signal: params.signal,
    },
  );
}

export interface CloseTerminalParams {
  gatewayUrl: string;
  sessionId: string;
  terminalId: string;
  token: string;
  signal?: AbortSignal;
}

export async function closeTerminal(params: CloseTerminalParams): Promise<{ ok: boolean }> {
  return createSessionTerminalsClient(params.gatewayUrl).close(
    params.token,
    params.sessionId,
    params.terminalId,
    { signal: params.signal },
  );
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
