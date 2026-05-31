/**
 * `/sessions/:id/terminals*` 客户端：列出 / 创建 / 交互 / 杀掉 / 删除会话终端。
 *
 * 之前位于 `apps/web/src/pages/chat-page/terminals-api.ts`，这里把它升格为 web-client
 * 的标准模块，让 desktop / mobile 也能复用。
 */

import type { SessionTerminalSummary } from '@openAwork/shared';
import {
  authHeader,
  extractJsonErrorMessage,
  HttpError,
  isGenericFetchErrorMessage,
  jsonAuthHeaders,
  readJsonErrorData,
  fetchWithTimeout,
} from '../gateway/http.js';

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
  create(
    token: string,
    sessionId: string,
    input?: { cwd?: string; description?: string; initialCommand?: string; signal?: AbortSignal },
  ): Promise<{ terminal: SessionTerminalView }>;
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
  rename(
    token: string,
    sessionId: string,
    terminalId: string,
    input: { name: string | null; signal?: AbortSignal },
  ): Promise<{ renamed: boolean; terminal: SessionTerminalView | null }>;
  writeStdin(
    token: string,
    sessionId: string,
    terminalId: string,
    input: { data: string; signal?: AbortSignal },
  ): Promise<{ ok: boolean; error?: string }>;
  resize(
    token: string,
    sessionId: string,
    terminalId: string,
    input: { cols: number; rows: number; signal?: AbortSignal },
  ): Promise<{ ok: boolean }>;
  close(
    token: string,
    sessionId: string,
    terminalId: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ ok: boolean }>;
}

interface SessionTerminalErrorData {
  data?: {
    message?: string;
  };
  error?: string;
  message?: string;
}

function buildSessionTerminalActionErrorMessage(
  actionLabel: string,
  status: number,
  data: SessionTerminalErrorData | undefined,
): string {
  if (status === 401 || status === 403 || data?.error === 'unauthorized') {
    return `认证失效或当前账号无权${actionLabel}。`;
  }
  if (data?.error === 'session_not_found') {
    return `目标会话不存在，无法${actionLabel}。`;
  }
  if (data?.error === 'terminal_not_found') {
    return `目标终端不存在，无法${actionLabel}。`;
  }
  if (data?.error === 'terminal_running') {
    return '终端仍在运行，请先终止后再清理。';
  }
  if (data?.error === 'terminal_not_persistent') {
    return '该终端是一次性命令，不支持继续输入。';
  }
  if (data?.error === 'invalid_body') {
    return `请求参数无效，无法${actionLabel}。`;
  }
  if (data?.error === 'spawn_failed') {
    return typeof data.message === 'string' && data.message.length > 0
      ? `创建终端失败：${data.message}`
      : '创建终端失败。';
  }
  const extracted = extractJsonErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 404) {
    return `目标资源不存在，无法${actionLabel}。`;
  }
  if (status === 409) {
    return `当前状态不允许${actionLabel}。`;
  }
  return `${actionLabel}失败（HTTP ${status}）。`;
}

function isGenericSessionTerminalNetworkErrorMessage(message: string): boolean {
  return isGenericFetchErrorMessage(message);
}

function normalizeSessionTerminalError(actionLabel: string, error: unknown): Error {
  if (error instanceof HttpError) {
    return error;
  }
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0 && !isGenericSessionTerminalNetworkErrorMessage(message)) {
      return error;
    }
  }
  return new Error(`网络异常，${actionLabel}失败。`);
}

async function performSessionTerminalRequest<T>(input: {
  actionLabel: string;
  parseJson?: boolean;
  request: () => Promise<Response>;
}): Promise<T> {
  try {
    const response = await input.request();
    if (!response.ok) {
      const data = await readJsonErrorData<SessionTerminalErrorData>(response);
      throw new HttpError(
        buildSessionTerminalActionErrorMessage(input.actionLabel, response.status, data),
        response.status,
        data,
      );
    }
    if (input.parseJson === false || response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  } catch (error) {
    throw normalizeSessionTerminalError(input.actionLabel, error);
  }
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
      return performSessionTerminalRequest<{ terminals: SessionTerminalView[] }>({
        actionLabel: '读取终端列表',
        request: () => fetchWithTimeout(url.toString(), init),
      });
    },

    async create(token, sessionId, input) {
      const init: RequestInit = {
        method: 'POST',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify({
          ...(input?.cwd ? { cwd: input.cwd } : {}),
          ...(input?.initialCommand ? { initialCommand: input.initialCommand } : {}),
          ...(input?.description ? { description: input.description } : {}),
        }),
      };
      if (input?.signal) init.signal = input.signal;
      return performSessionTerminalRequest<{ terminal: SessionTerminalView }>({
        actionLabel: '创建终端',
        request: () =>
          fetchWithTimeout(`${baseUrl}/sessions/${encodeURIComponent(sessionId)}/terminals`, init),
      });
    },

    async kill(token, sessionId, terminalId, options) {
      const init: RequestInit = { method: 'POST', headers: authHeader(token) };
      if (options?.signal) init.signal = options.signal;
      return performSessionTerminalRequest<{
        result: { found: boolean; alreadyClosed: boolean; killed: boolean };
        terminal: SessionTerminalView | null;
      }>({
        actionLabel: '终止终端',
        request: () =>
          fetchWithTimeout(
            `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/terminals/${encodeURIComponent(terminalId)}/kill`,
            init,
          ),
      });
    },

    async remove(token, sessionId, terminalId, options) {
      const init: RequestInit = { method: 'DELETE', headers: authHeader(token) };
      if (options?.signal) init.signal = options.signal;
      return performSessionTerminalRequest<{ deleted: boolean }>({
        actionLabel: '删除终端记录',
        request: () =>
          fetchWithTimeout(
            `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/terminals/${encodeURIComponent(terminalId)}`,
            init,
          ),
      });
    },

    async rename(token, sessionId, terminalId, input) {
      const init: RequestInit = {
        method: 'PATCH',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify({ name: input.name }),
      };
      if (input.signal) init.signal = input.signal;
      return performSessionTerminalRequest<{
        renamed: boolean;
        terminal: SessionTerminalView | null;
      }>({
        actionLabel: '重命名终端',
        request: () =>
          fetchWithTimeout(
            `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/terminals/${encodeURIComponent(terminalId)}`,
            init,
          ),
      });
    },

    async writeStdin(token, sessionId, terminalId, input) {
      const init: RequestInit = {
        method: 'POST',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify({ data: input.data }),
      };
      if (input.signal) init.signal = input.signal;
      return performSessionTerminalRequest<{ ok: boolean; error?: string }>({
        actionLabel: '写入终端输入',
        request: () =>
          fetchWithTimeout(
            `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/terminals/${encodeURIComponent(terminalId)}/stdin`,
            init,
          ),
      });
    },

    async resize(token, sessionId, terminalId, input) {
      const init: RequestInit = {
        method: 'POST',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify({ cols: input.cols, rows: input.rows }),
      };
      if (input.signal) init.signal = input.signal;
      return performSessionTerminalRequest<{ ok: boolean }>({
        actionLabel: '调整终端尺寸',
        request: () =>
          fetchWithTimeout(
            `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/terminals/${encodeURIComponent(terminalId)}/resize`,
            init,
          ),
      });
    },

    async close(token, sessionId, terminalId, options) {
      const init: RequestInit = { method: 'POST', headers: authHeader(token) };
      if (options?.signal) init.signal = options.signal;
      return performSessionTerminalRequest<{ ok: boolean }>({
        actionLabel: '关闭终端',
        request: () =>
          fetchWithTimeout(
            `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/terminals/${encodeURIComponent(terminalId)}/close`,
            init,
          ),
      });
    },
  };
}
