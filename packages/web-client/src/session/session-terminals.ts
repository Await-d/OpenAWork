/**
 * `/sessions/:id/terminals*` 客户端：列出 / 杀掉 / 删除会话终端。
 *
 * 之前位于 `apps/web/src/pages/chat-page/terminals-api.ts`，这里把它升格为 web-client
 * 的标准模块，让 desktop / mobile 也能复用。
 */

import type { SessionTerminalSummary } from '@openAwork/shared';
import { authHeader, expectJson } from '../gateway/http.js';

export type SessionTerminalView = SessionTerminalSummary;

export interface ListSessionTerminalsOptions {
  status?: 'running' | 'all';
  limit?: number;
  signal?: AbortSignal;
}

export interface SessionTerminalsClient {
  list(
    token: string,
    sessionId: string,
    options?: ListSessionTerminalsOptions,
  ): Promise<{ terminals: SessionTerminalView[] }>;
  kill(
    token: string,
    sessionId: string,
    terminalId: string,
    options?: { signal?: AbortSignal },
  ): Promise<{
    result: { found: boolean; alreadyClosed: boolean; killed: boolean };
    terminal: SessionTerminalView | null;
  }>;
  remove(
    token: string,
    sessionId: string,
    terminalId: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ deleted: boolean }>;
}

export function createSessionTerminalsClient(baseUrl: string): SessionTerminalsClient {
  return {
    async list(token, sessionId, options) {
      const url = new URL(`${baseUrl}/sessions/${encodeURIComponent(sessionId)}/terminals`);
      if (options?.status) {
        url.searchParams.set('status', options.status);
      }
      if (options?.limit !== undefined) {
        url.searchParams.set('limit', String(options.limit));
      }
      const init: RequestInit = { headers: authHeader(token) };
      if (options?.signal) init.signal = options.signal;
      const response = await fetch(url.toString(), init);
      return expectJson<{ terminals: SessionTerminalView[] }>(response, 'sessionTerminals.list');
    },

    async kill(token, sessionId, terminalId, options) {
      const init: RequestInit = { method: 'POST', headers: authHeader(token) };
      if (options?.signal) init.signal = options.signal;
      const response = await fetch(
        `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/terminals/${encodeURIComponent(terminalId)}/kill`,
        init,
      );
      return expectJson<{
        result: { found: boolean; alreadyClosed: boolean; killed: boolean };
        terminal: SessionTerminalView | null;
      }>(response, 'sessionTerminals.kill');
    },

    async remove(token, sessionId, terminalId, options) {
      const init: RequestInit = { method: 'DELETE', headers: authHeader(token) };
      if (options?.signal) init.signal = options.signal;
      const response = await fetch(
        `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/terminals/${encodeURIComponent(terminalId)}`,
        init,
      );
      const data = await expectJson<{ deleted: boolean }>(response, 'sessionTerminals.remove');
      return data;
    },
  };
}
