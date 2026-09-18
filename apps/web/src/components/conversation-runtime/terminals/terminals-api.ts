/**
 * Client-side wrapper around `/sessions/:sessionId/terminals` routes.
 * The backend contract lives in
 * `services/agent-gateway/src/routes/session-terminals.ts` and
 * the shared types in `@openAwork/shared`.
 */

import { createSessionTerminalsClient } from '@openAwork/web-client';
import type {
  SessionTerminalView as GatewaySessionTerminalView,
  ShellProfileOption,
} from '@openAwork/web-client';

export type { ShellProfileOption };

/**
 * 终端视图（加法扩展，T-06）：网关公共载荷新增 `backend` / `supportsResize`
 * （契约来源：`services/agent-gateway/src/routes/session-terminals.ts`）。
 *
 * 两个字段都保持可选 —— 旧网关，以及由 `terminal_started` 事件本地构造的行
 * 不携带能力信息；此时消费方维持原行为（继续尝试 resize），不会因为字段缺失
 * 而静默降级。`list` 与 SSE 载荷均为原始 JSON 透传，字段不会被解析层丢弃。
 */
export interface SessionTerminalView extends GatewaySessionTerminalView {
  backend?: 'pty' | 'pipe';
  supportsResize?: boolean;
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
  /** 服务端白名单 id（来自 listShellProfiles）；非法值由网关 400 拒绝。 */
  shellProfileId?: string;
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
    shellProfileId: params.shellProfileId,
    signal: params.signal,
  });
}

export interface ListShellProfilesParams {
  gatewayUrl: string;
  token: string;
  signal?: AbortSignal;
}

/** 宿主级（非会话级）的 shell 配置列表，因此不需要 sessionId。 */
export async function listShellProfiles(
  params: ListShellProfilesParams,
): Promise<ShellProfileOption[]> {
  const { profiles } = await createSessionTerminalsClient(params.gatewayUrl).listShellProfiles(
    params.token,
    { signal: params.signal },
  );
  return profiles;
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

/**
 * Lifecycle of the per-terminal SSE connection. `reconnecting` is
 * surfaced by the native EventSource retry path (server restart, network
 * blip, tunnel hiccup) — previously invisible to the UI, which made a
 * dropped terminal stream look like a hung terminal.
 */
export type TerminalStreamStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

/**
 * `snapshot` 事件载荷（契约 §2.3 冻结）：连接建立时立即下发一次，
 * `data` 是 ring buffer 全文，`seq` 是「最后一个字节的单调序号」。
 *
 * 兼容策略：旧后端只发 `outputTail`（无 `seq` / `data`），解析层把
 * `outputTail` 回退成 `data`、`seq` 回退成 0，前端仍能工作。
 */
export interface TerminalStreamSnapshotPayload {
  terminalId: string;
  seq: number;
  data: string;
  outputBytesTotal: number;
  status: string;
}

/**
 * `output` 事件载荷（契约 §2.2 / §3.1）：`data` 为**增量**文本，
 * `seq` 为本 chunk 末字节序号。两个字段都缺省时回退到旧的
 * 「累积 tail + 总字节」diff 语义。
 */
export interface TerminalStreamOutputPayload {
  seq?: number;
  data?: string;
  outputTail?: string;
  outputBytesTotal: number;
}

export interface OpenTerminalStreamParams {
  gatewayUrl: string;
  sessionId: string;
  terminalId: string;
  token: string;
  onSnapshot?: (snapshot: TerminalStreamSnapshotPayload) => void;
  onOutput?: (chunk: TerminalStreamOutputPayload) => void;
  onExited?: (chunk: { status: string; exitCode?: number }) => void;
  onError?: (error: Error) => void;
  /** Optional connection-state observer; see `TerminalStreamStatus`. */
  onStatus?: (status: TerminalStreamStatus) => void;
}

/** 安全读取 JSON 对象字段：非对象输入返回 `undefined`，避免 `any` 断言。 */
function readJsonField(source: unknown, key: string): unknown {
  if (typeof source !== 'object' || source === null) {
    return undefined;
  }
  return (source as Record<string, unknown>)[key];
}

function readJsonString(source: unknown, key: string): string | null {
  const value = readJsonField(source, key);
  return typeof value === 'string' ? value : null;
}

function readJsonNumber(source: unknown, key: string): number | null {
  const value = readJsonField(source, key);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * 解析 `snapshot` 事件。`fallbackTerminalId` 用于后端漏发 `terminalId`
 * 的兜底（事件本身已绑定到唯一终端）。
 * @throws 当载荷不是对象时抛错，由调用方走 `onError` 通道。
 */
export function parseTerminalSnapshotPayload(
  raw: unknown,
  fallbackTerminalId: string,
): TerminalStreamSnapshotPayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('terminal snapshot payload is not an object');
  }
  return {
    terminalId: readJsonString(raw, 'terminalId') ?? fallbackTerminalId,
    seq: readJsonNumber(raw, 'seq') ?? 0,
    // 旧后端没有 `data`，此时 snapshot 的 `outputTail` 就是它能给到的全部历史。
    data: readJsonString(raw, 'data') ?? readJsonString(raw, 'outputTail') ?? '',
    outputBytesTotal: readJsonNumber(raw, 'outputBytesTotal') ?? 0,
    status: readJsonString(raw, 'status') ?? 'unknown',
  };
}

/**
 * 解析 `output` 事件。可选字段仅在载荷里真实存在时才写入，避免把
 * 「字段缺省」误判成「空字符串增量」。
 * @throws 当载荷不是对象时抛错，由调用方走 `onError` 通道。
 */
export function parseTerminalOutputPayload(raw: unknown): TerminalStreamOutputPayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('terminal output payload is not an object');
  }
  const payload: TerminalStreamOutputPayload = {
    outputBytesTotal: readJsonNumber(raw, 'outputBytesTotal') ?? 0,
  };
  const seq = readJsonNumber(raw, 'seq');
  if (seq !== null) payload.seq = seq;
  const data = readJsonString(raw, 'data');
  if (data !== null) payload.data = data;
  const outputTail = readJsonString(raw, 'outputTail');
  if (outputTail !== null) payload.outputTail = outputTail;
  return payload;
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
  params.onStatus?.('connecting');
  const source = new EventSource(url.toString());

  source.addEventListener('open', () => {
    params.onStatus?.('open');
  });

  source.addEventListener('snapshot', (event) => {
    try {
      params.onSnapshot?.(
        parseTerminalSnapshotPayload(JSON.parse((event as MessageEvent).data), params.terminalId),
      );
    } catch (error) {
      params.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  });
  source.addEventListener('output', (event) => {
    try {
      params.onOutput?.(parseTerminalOutputPayload(JSON.parse((event as MessageEvent).data)));
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
      params.onStatus?.('closed');
      params.onError?.(new Error('terminal stream closed'));
      return;
    }
    // CONNECTING means the browser is going to retry on its own timer.
    // Report it so callers can show "重连中" instead of a frozen pane.
    if (source.readyState === EventSource.CONNECTING) {
      params.onStatus?.('reconnecting');
    }
  });
  return source;
}
