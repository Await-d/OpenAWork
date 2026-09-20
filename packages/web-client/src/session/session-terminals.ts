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

/**
 * 服务端白名单里的 shell 配置。只含不透明 id 与展示标签——服务端绝不会
 * 下发可执行文件路径，客户端也只能回传 id。
 */
export interface ShellProfileOption {
  id: string;
  label: string;
  isDefault: boolean;
}

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
  listShellProfiles(
    token: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ profiles: ShellProfileOption[] }>;
  create(
    token: string,
    sessionId: string,
    input?: {
      cwd?: string;
      description?: string;
      initialCommand?: string;
      /** 必须是 listShellProfiles 返回的白名单 id；服务端拒绝其他取值。 */
      shellProfileId?: string;
      signal?: AbortSignal;
    },
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
  if (data?.error === 'invalid_shell_profile') {
    return '所选 Shell 配置在此机器上不可用，请重新选择。';
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

    async listShellProfiles(token, options) {
      const init: RequestInit = { headers: authHeader(token) };
      if (options?.signal) init.signal = options.signal;
      return performSessionTerminalRequest<{ profiles: ShellProfileOption[] }>({
        actionLabel: '读取 Shell 配置',
        request: () => fetchWithTimeout(`${baseUrl}/terminals/shell-profiles`, init),
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
          ...(input?.shellProfileId ? { shellProfileId: input.shellProfileId } : {}),
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

// ─── 终端 WebSocket ──────────────────────────────────────────────────────

/**
 * S→C `snapshot` 帧：连接建立时下发的滚动缓冲快照。`seq` 是快照末字节的
 * 游标，调用方据此丢弃重连后重复的增量输出；`interactive` 表示后端是否
 * 具备真实 PTY（缺省视为未知，前端不应伪装交互式提示符）。
 */
export interface TerminalSocketSnapshot {
  terminalId: string;
  seq: number;
  data: string;
  outputBytesTotal: number;
  status: string;
  interactive?: boolean;
}

/** S→C `output` 帧：增量输出（**非**累计）。 */
export interface TerminalSocketOutput {
  terminalId: string;
  seq: number;
  data: string;
  outputBytesTotal: number;
}

/** S→C `exit` 帧：终端进程退出。 */
export interface TerminalSocketExit {
  status: string;
  exitCode: number | null;
}

/**
 * 终端 WebSocket 回调。`onSnapshot` / `onOutput` 必填——缺了调用方就收不到
 * 任何输出；其余是可选的生命周期钩子。
 */
export interface TerminalSocketHandlers {
  onOpen?: () => void;
  onSnapshot: (payload: TerminalSocketSnapshot) => void;
  onOutput: (payload: TerminalSocketOutput) => void;
  onExit?: (payload: TerminalSocketExit) => void;
  onError?: (error: Error) => void;
  onClose?: (info: { code: number; reason: string }) => void;
}

/**
 * 终端 WebSocket 句柄。只负责单次连接：重连 / 退避由调用方根据
 * `onClose` / `onError` 自行决定。
 */
export interface TerminalSocket {
  readonly state: 'connecting' | 'open' | 'closed';
  sendInput(data: string): void;
  sendResize(cols: number, rows: number): void;
  close(): void;
}

/** 服务端 `error` 帧的错误：`message` 面向用户，`code` 供调用方分支判断。 */
class TerminalSocketFrameError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message.length > 0 ? message : `终端 WebSocket 错误：${code}`);
    this.name = 'TerminalSocketFrameError';
    this.code = code;
  }
}

type TerminalSocketFrame = Record<string, unknown>;

function parseTerminalSocketFrame(raw: unknown): TerminalSocketFrame | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as TerminalSocketFrame;
  } catch {
    // 畸形帧直接忽略——一条坏消息不该打断整个连接。
    return null;
  }
}

function readTerminalSocketString(frame: TerminalSocketFrame, key: string): string | null {
  const value = frame[key];
  return typeof value === 'string' ? value : null;
}

function readTerminalSocketNumber(frame: TerminalSocketFrame, key: string): number | null {
  const value = frame[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readTerminalSocketSnapshot(frame: TerminalSocketFrame): TerminalSocketSnapshot | null {
  const terminalId = readTerminalSocketString(frame, 'terminalId');
  const seq = readTerminalSocketNumber(frame, 'seq');
  const data = readTerminalSocketString(frame, 'data');
  const outputBytesTotal = readTerminalSocketNumber(frame, 'outputBytesTotal');
  const status = readTerminalSocketString(frame, 'status');
  if (
    terminalId === null ||
    seq === null ||
    data === null ||
    outputBytesTotal === null ||
    status === null
  ) {
    return null;
  }
  const interactive = frame['interactive'];
  return {
    terminalId,
    seq,
    data,
    outputBytesTotal,
    status,
    ...(typeof interactive === 'boolean' ? { interactive } : {}),
  };
}

function readTerminalSocketOutput(frame: TerminalSocketFrame): TerminalSocketOutput | null {
  const terminalId = readTerminalSocketString(frame, 'terminalId');
  const seq = readTerminalSocketNumber(frame, 'seq');
  const data = readTerminalSocketString(frame, 'data');
  const outputBytesTotal = readTerminalSocketNumber(frame, 'outputBytesTotal');
  if (terminalId === null || seq === null || data === null || outputBytesTotal === null) {
    return null;
  }
  return { terminalId, seq, data, outputBytesTotal };
}

function readTerminalSocketExit(frame: TerminalSocketFrame): TerminalSocketExit | null {
  const status = readTerminalSocketString(frame, 'status');
  if (status === null) return null;
  return { status, exitCode: readTerminalSocketNumber(frame, 'exitCode') };
}

function dispatchTerminalSocketFrame(
  frame: TerminalSocketFrame,
  handlers: TerminalSocketHandlers,
): void {
  const type = readTerminalSocketString(frame, 'type');
  if (type === 'snapshot') {
    const snapshot = readTerminalSocketSnapshot(frame);
    if (snapshot) handlers.onSnapshot(snapshot);
    return;
  }
  if (type === 'output') {
    const output = readTerminalSocketOutput(frame);
    if (output) handlers.onOutput(output);
    return;
  }
  if (type === 'exit') {
    const exit = readTerminalSocketExit(frame);
    if (exit) handlers.onExit?.(exit);
    return;
  }
  if (type === 'error') {
    const code = readTerminalSocketString(frame, 'code') ?? 'TERMINAL_SOCKET_ERROR';
    const message = readTerminalSocketString(frame, 'message') ?? '';
    handlers.onError?.(new TerminalSocketFrameError(code, message));
  }
  // `pong` 心跳应答与未知帧类型一律静默忽略（前向兼容）。
}

/**
 * 打开终端 WebSocket：`GET {gatewayUrl}/sessions/:sessionId/terminals/:terminalId/ws`。
 *
 * 与终端 HTTP 客户端同址；token 走查询参数（浏览器 WebSocket 无法自定义
 * 请求头），`afterSeq` 为增量回放游标（独占）。`sendInput` / `sendResize` 在
 * 连接未 OPEN 时是 no-op，`close()` 幂等。
 */
export function openTerminalSocket(options: {
  gatewayUrl: string;
  accessToken: string;
  sessionId: string;
  terminalId: string;
  afterSeq?: number;
  handlers: TerminalSocketHandlers;
}): TerminalSocket {
  const { handlers } = options;
  // `http(s)://` → `ws(s)://`；已经是 ws/wss 的地址保持不变。
  const socketBase = options.gatewayUrl.replace(/^http/, 'ws');
  const sessionPath = encodeURIComponent(options.sessionId);
  const terminalPath = encodeURIComponent(options.terminalId);
  const url = new URL(`${socketBase}/sessions/${sessionPath}/terminals/${terminalPath}/ws`);
  url.searchParams.set('token', options.accessToken);
  if (options.afterSeq !== undefined) {
    url.searchParams.set('afterSeq', String(options.afterSeq));
  }

  const ws = new WebSocket(url.toString());
  let state: TerminalSocket['state'] = 'connecting';

  ws.onopen = () => {
    // close() during CONNECTING already settled the handle; ignore a late open.
    if (state === 'closed') return;
    state = 'open';
    handlers.onOpen?.();
  };

  ws.onmessage = (event) => {
    const frame = parseTerminalSocketFrame(event.data);
    if (!frame) return;
    dispatchTerminalSocketFrame(frame, handlers);
  };

  ws.onerror = () => {
    handlers.onError?.(new Error('终端 WebSocket 连接异常。'));
  };

  ws.onclose = (event) => {
    state = 'closed';
    // 浏览器一定带 CloseEvent；兜底只服务于省略参数的 mock。
    const code = typeof event?.code === 'number' ? event.code : 1005;
    const reason = typeof event?.reason === 'string' ? event.reason : '';
    handlers.onClose?.({ code, reason });
  };

  return {
    get state() {
      return state;
    },
    sendInput(data) {
      if (state !== 'open') return;
      ws.send(JSON.stringify({ type: 'input', data }));
    },
    sendResize(cols, rows) {
      if (state !== 'open') return;
      ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    },
    close() {
      if (state === 'closed') return;
      state = 'closed';
      ws.close();
    },
  };
}
