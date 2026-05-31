/**
 * `/ssh/*` 客户端：连接管理、远端文件浏览、上传，外加重启后用于恢复
 * 「上一次打开的 SSH 对话」的 dialog 端点。
 *
 * 网关把 SSH 通道托管在 sidecar 里，前端只需要开关连接、浏览文件，并
 * 通过 dialog 端点把面板状态（最近的目录、预览路径）记账下去。
 */

import {
  authHeader,
  extractJsonErrorMessage,
  HttpError,
  isGenericFetchErrorMessage,
  jsonAuthHeaders,
  readJsonErrorData,
  type JsonErrorData,
  withQuery,
  fetchWithTimeout,
} from '../gateway/http.js';

export type SSHAuthType = 'password' | 'key' | 'agent';

export interface SSHConnectionEntry {
  id: string;
  name?: string;
  host: string;
  port: number;
  username: string;
  authType?: SSHAuthType;
  privateKeyPath?: string | null;
  hasPassword?: boolean;
  autoReconnect?: boolean;
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  lastError?: string | null;
  lastConnectedAt?: number | null;
  createdAt?: number;
  updatedAt?: number;
  [key: string]: unknown;
}

export interface SSHFileEntry {
  name: string;
  path: string;
  kind: 'file' | 'directory';
}

export interface SSHFilePreview {
  path: string;
  content: string;
  encoding?: 'utf8' | 'base64';
  truncated?: boolean;
}

export interface SSHBindingEntry {
  sessionId: string;
  connectionId: string;
  updatedAt: number;
}

export interface SSHDialogEntry {
  id: string;
  connectionId: string;
  title: string | null;
  cwd: string;
  lastFilePath: string | null;
  lastFileEncoding: 'utf8' | 'base64' | null;
  pinned: boolean;
  lastOpenedAt: number;
}

export type CreateSSHConnectionInput = Omit<
  SSHConnectionEntry,
  'id' | 'status' | 'hasPassword' | 'lastError' | 'lastConnectedAt' | 'createdAt' | 'updatedAt'
> & { password?: string };

export type UpdateSSHConnectionInput = Partial<CreateSSHConnectionInput>;

export interface UpsertSSHDialogInput {
  connectionId: string;
  title?: string | null;
  cwd?: string;
  lastFilePath?: string | null;
  lastFileEncoding?: 'utf8' | 'base64' | null;
  pinned?: boolean;
  touch?: boolean;
}

export interface SSHClient {
  list(token: string, options?: { signal?: AbortSignal }): Promise<SSHConnectionEntry[]>;
  create(token: string, input: CreateSSHConnectionInput): Promise<SSHConnectionEntry>;
  update(
    token: string,
    connectionId: string,
    patch: UpdateSSHConnectionInput,
  ): Promise<SSHConnectionEntry>;
  remove(token: string, connectionId: string): Promise<void>;
  connect(token: string, connectionId: string): Promise<SSHConnectionEntry | void>;
  disconnect(token: string, connectionId: string): Promise<SSHConnectionEntry | void>;
  /**
   * Bind a chat session to an SSH connection. The legacy two-arg form
   * `bind(token, connectionId)` is preserved for backward compatibility
   * with consumers that don't yet have a session id; in that mode the
   * gateway records a placeholder binding under the user.
   */
  bind(token: string, connectionId: string, sessionId?: string): Promise<void>;
  unbindSession(token: string, sessionId: string): Promise<void>;
  listBindings(token: string, options?: { signal?: AbortSignal }): Promise<SSHBindingEntry[]>;
  listFiles(token: string, connectionId: string, path: string): Promise<SSHFileEntry[]>;
  readFile(token: string, connectionId: string, path: string): Promise<SSHFilePreview>;
  upload(
    token: string,
    input: { connectionId: string; path: string; contentBase64: string },
  ): Promise<void>;
  listDialogs(token: string, options?: { signal?: AbortSignal }): Promise<SSHDialogEntry[]>;
  getLastOpenedDialog(
    token: string,
    options?: { signal?: AbortSignal },
  ): Promise<SSHDialogEntry | null>;
  touchDialog(token: string, input: UpsertSSHDialogInput): Promise<SSHDialogEntry>;
  deleteDialog(token: string, dialogId: string): Promise<void>;
}

function buildSshActionErrorMessage(
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
    return `目标 SSH 资源不存在，无法${actionLabel}。`;
  }
  if (status === 409) {
    return `当前状态不允许${actionLabel}。`;
  }
  return `${actionLabel}失败（HTTP ${status}）。`;
}

function isGenericSshNetworkErrorMessage(message: string): boolean {
  return isGenericFetchErrorMessage(message);
}

function normalizeSshError(actionLabel: string, error: unknown): Error {
  if (error instanceof HttpError) {
    const extracted = extractJsonErrorMessage(
      (error.data ?? undefined) as JsonErrorData | undefined,
    );
    if (extracted) {
      return new HttpError(extracted, error.status, error.data);
    }
    return error;
  }
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0 && !isGenericSshNetworkErrorMessage(message)) {
      return error;
    }
  }
  return new Error(`网络异常，${actionLabel}失败。`);
}

async function performSshRequest<T>(input: {
  actionLabel: string;
  parseJson?: boolean;
  request: () => Promise<Response>;
}): Promise<T> {
  try {
    const response = await input.request();
    if (!response.ok) {
      const data = await readJsonErrorData<JsonErrorData>(response);
      throw new HttpError(
        buildSshActionErrorMessage(input.actionLabel, response.status, data),
        response.status,
        data,
      );
    }
    if (input.parseJson === false || response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  } catch (error) {
    throw normalizeSshError(input.actionLabel, error);
  }
}

export function createSshClient(baseUrl: string): SSHClient {
  const connectionEndpoint = (id: string): string =>
    `${baseUrl}/ssh/connections/${encodeURIComponent(id)}`;

  return {
    async list(token, options) {
      const data = await performSshRequest<{ connections: SSHConnectionEntry[] }>({
        actionLabel: '读取 SSH 连接列表',
        request: () =>
          fetchWithTimeout(`${baseUrl}/ssh/connections`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
      return data.connections ?? [];
    },

    async create(token, input) {
      const data = await performSshRequest<{ connection: SSHConnectionEntry }>({
        actionLabel: '创建 SSH 连接',
        request: () =>
          fetchWithTimeout(`${baseUrl}/ssh/connections`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(input),
          }),
      });
      return data.connection;
    },

    async update(token, connectionId, patch) {
      const data = await performSshRequest<{ connection: SSHConnectionEntry }>({
        actionLabel: '更新 SSH 连接',
        request: () =>
          fetchWithTimeout(connectionEndpoint(connectionId), {
            method: 'PATCH',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(patch),
          }),
      });
      return data.connection;
    },

    async remove(token, connectionId) {
      await performSshRequest({
        actionLabel: '删除 SSH 连接',
        parseJson: false,
        request: () =>
          fetchWithTimeout(connectionEndpoint(connectionId), {
            method: 'DELETE',
            headers: authHeader(token),
          }),
      });
    },

    async connect(token, connectionId) {
      const data = await performSshRequest<{ connection?: SSHConnectionEntry }>({
        actionLabel: '连接 SSH',
        request: () =>
          fetchWithTimeout(`${connectionEndpoint(connectionId)}/connect`, {
            method: 'POST',
            headers: authHeader(token),
          }),
      });
      return data?.connection;
    },

    async disconnect(token, connectionId) {
      const data = await performSshRequest<{ connection?: SSHConnectionEntry }>({
        actionLabel: '断开 SSH 连接',
        request: () =>
          fetchWithTimeout(`${connectionEndpoint(connectionId)}/disconnect`, {
            method: 'POST',
            headers: authHeader(token),
          }),
      });
      return data?.connection;
    },

    async bind(token, connectionId, sessionId) {
      // Backwards-compat: when no sessionId is supplied (legacy callers),
      // synthesise a deterministic placeholder so the binding row exists
      // and the panel can still surface a "session pinned" indicator after
      // the gateway restart.
      const effectiveSessionId = sessionId ?? `placeholder:${connectionId}`;
      await performSshRequest({
        actionLabel: '绑定 SSH 连接',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${connectionEndpoint(connectionId)}/bind`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify({ sessionId: effectiveSessionId }),
          }),
      });
    },

    async unbindSession(token, sessionId) {
      await performSshRequest({
        actionLabel: '解绑 SSH 连接',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/ssh/bindings/unbind`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify({ sessionId }),
          }),
      });
    },

    async listBindings(token, options) {
      const data = await performSshRequest<{ bindings: SSHBindingEntry[] }>({
        actionLabel: '读取 SSH 绑定列表',
        request: () =>
          fetchWithTimeout(`${baseUrl}/ssh/bindings`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
      return data.bindings ?? [];
    },

    async listFiles(token, connectionId, path) {
      const params = new URLSearchParams({ connectionId, path });
      const data = await performSshRequest<{ entries: SSHFileEntry[] }>({
        actionLabel: '读取 SSH 文件列表',
        request: () =>
          fetchWithTimeout(withQuery(`${baseUrl}/ssh/files`, params), {
            headers: authHeader(token),
          }),
      });
      return data.entries ?? [];
    },

    async readFile(token, connectionId, path) {
      const params = new URLSearchParams({ connectionId, path });
      const data = await performSshRequest<{ preview: SSHFilePreview }>({
        actionLabel: '读取 SSH 文件预览',
        request: () =>
          fetchWithTimeout(withQuery(`${baseUrl}/ssh/file`, params), {
            headers: authHeader(token),
          }),
      });
      return data.preview;
    },

    async upload(token, input) {
      await performSshRequest({
        actionLabel: '上传 SSH 文件',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/ssh/upload`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(input),
          }),
      });
    },

    async listDialogs(token, options) {
      const data = await performSshRequest<{ dialogs: SSHDialogEntry[] }>({
        actionLabel: '读取 SSH 对话列表',
        request: () =>
          fetchWithTimeout(`${baseUrl}/ssh/dialogs`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
      return data.dialogs ?? [];
    },

    async getLastOpenedDialog(token, options) {
      const data = await performSshRequest<{ dialog: SSHDialogEntry | null }>({
        actionLabel: '读取最近 SSH 对话',
        request: () =>
          fetchWithTimeout(`${baseUrl}/ssh/dialogs/last`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
      return data.dialog ?? null;
    },

    async touchDialog(token, input) {
      const data = await performSshRequest<{ dialog: SSHDialogEntry }>({
        actionLabel: '更新 SSH 对话状态',
        request: () =>
          fetchWithTimeout(`${baseUrl}/ssh/dialogs/touch`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(input),
          }),
      });
      return data.dialog;
    },

    async deleteDialog(token, dialogId) {
      await performSshRequest({
        actionLabel: '删除 SSH 对话',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/ssh/dialogs/${encodeURIComponent(dialogId)}`, {
            method: 'DELETE',
            headers: authHeader(token),
          }),
      });
    },
  };
}
