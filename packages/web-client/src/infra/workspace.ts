/**
 * 工作区相关的网关客户端：
 * - `/workspace/root` 列出可用工作区根目录；
 * - `/workspace/tree` 拉取目录树；
 * - `/workspace/file` 读 / 写 / 新建文件；
 * - `/workspace/directory` 新建文件夹；
 * - `/workspace/validate` 校验路径是否可用；
 * - `/workspace/search` 工作区内全文搜索；
 * - `/workspace/review/*` Git 审阅（status / diff / revert）；
 * - `/sessions/:id/workspace` 绑定 / 解绑会话工作区。
 *
 * 所有方法返回原始负载，错误统一抛 `HttpError`，由调用方决定文案。
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

export interface FileTreeNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
}

export interface WorkspaceFileContent {
  content: string;
  truncated?: boolean;
}

export interface WorkspaceValidateResult {
  valid: boolean;
  error?: string;
  path?: string;
}

export interface WorkspaceRootsResponse {
  /** 当前活跃 / 默认根。多根场景下不一定与 `roots[0]` 相同。 */
  root?: string;
  /** 全部已注册根；移动端 / 团队工作区可能返回多条。 */
  roots?: string[];
}

export interface WorkspaceSearchHit {
  path: string;
  line: number;
  text: string;
}

export interface WorkspaceReviewChange {
  path: string;
  status: string;
  staged?: boolean;
  [key: string]: unknown;
}

export interface WorkspaceReviewStatusResponse {
  changes: WorkspaceReviewChange[];
}

export interface WorkspaceReviewDiffResponse {
  diff: string;
}

export interface SessionWorkspaceUpdateResponse {
  ok?: boolean;
  workingDirectory?: string | null;
}

export interface WorkspaceRootsLoadResult {
  errorMessage?: string;
  ok: boolean;
  retryable: boolean;
  roots: string[];
  status?: number;
}

export interface WorkspaceTreeLoadResult {
  errorMessage?: string;
  nodes: FileTreeNode[];
  ok: boolean;
  retryable: boolean;
  status?: number;
}

export interface WorkspaceReviewStatusLoadResult {
  changes: WorkspaceReviewChange[];
  errorMessage?: string;
  ok: boolean;
  retryable: boolean;
  status?: number;
}

export interface WorkspaceFileLoadResult {
  errorMessage?: string;
  file?: WorkspaceFileContent;
  ok: boolean;
  retryable: boolean;
  status?: number;
}

export interface WorkspaceClient {
  /** GET `/workspace/root`，返回所有工作区根目录的 `roots` 数组（旧版本只回 `root` 字段也兼容）。 */
  listRoots(token: string, options?: { signal?: AbortSignal }): Promise<string[]>;
  listRootsResult(
    token: string,
    options?: { signal?: AbortSignal },
  ): Promise<WorkspaceRootsLoadResult>;
  /** GET `/workspace/tree?path=&depth=`，返回展开 `depth` 层的目录树。 */
  fetchTree(
    token: string,
    path: string,
    options?: { depth?: number; signal?: AbortSignal },
  ): Promise<FileTreeNode[]>;
  fetchTreeResult(
    token: string,
    path: string,
    options?: { depth?: number; signal?: AbortSignal },
  ): Promise<WorkspaceTreeLoadResult>;
  /**
   * GET `/workspace/file?path=&workspaceRoot=`,读取单个文件内容（含 `truncated` 标志）。
   *
   * 当 `workspaceRoot` 提供时,后端会校验目标路径必须在该 root 之下,
   * 阻止跨工作区读取。前端常规调用应当总是带上当前会话的 workspace
   * root,默认情况下后端只会校验全局 WORKSPACE_ROOTS 白名单 — 不够严格。
   */
  readFile(
    token: string,
    path: string,
    options?: { signal?: AbortSignal; workspaceRoot?: string },
  ): Promise<WorkspaceFileContent>;
  readFileResult(
    token: string,
    path: string,
    options?: { signal?: AbortSignal; workspaceRoot?: string },
  ): Promise<WorkspaceFileLoadResult>;
  /**
   * GET `/workspace/file/binary?path=&workspaceRoot=`,读取文件原始字节。
   *
   * 用于 docx / xlsx / pdf 等二进制预览。返回 ArrayBuffer + 推断
   * 的 Content-Type。复用 readFile 同款的 workspaceRoot 校验。
   */
  readFileBinary(
    token: string,
    path: string,
    options?: { signal?: AbortSignal; workspaceRoot?: string },
  ): Promise<{ buffer: ArrayBuffer; contentType: string }>;
  /** PUT `/workspace/file`，按 `path` 覆盖写入。 */
  writeFile(token: string, path: string, content: string): Promise<void>;
  /** POST `/workspace/file`，创建新文件（默认空内容）。 */
  createFile(token: string, path: string, content?: string): Promise<void>;
  /** POST `/workspace/directory`，创建空目录。 */
  createDirectory(token: string, path: string): Promise<void>;
  /** GET `/workspace/validate?path=`，校验路径是否在允许范围内。 */
  validatePath(token: string, path: string): Promise<WorkspaceValidateResult>;
  /** GET `/workspace/search?q=&path=&maxResults=`。 */
  search(
    token: string,
    query: string,
    rootPath: string,
    options?: { maxResults?: number; signal?: AbortSignal },
  ): Promise<WorkspaceSearchHit[]>;
  /**
   * GET `/workspace/find-by-name?name=&path=&maxResults=`.
   *
   * Locates files whose **basename** matches `name` exactly. Distinct
   * from `search()` which is a content grep — this is the right
   * primitive for "user clicked a bare filename in chat, find the
   * actual file" since search() can't surface a file that doesn't
   * mention itself in its own contents.
   */
  findByName(
    token: string,
    name: string,
    rootPath: string,
    options?: { maxResults?: number; signal?: AbortSignal },
  ): Promise<Array<{ path: string }>>;
  /** GET `/workspace/review/status?path=`，列出未提交改动。 */
  reviewStatus(
    token: string,
    path: string,
    options?: { signal?: AbortSignal },
  ): Promise<WorkspaceReviewChange[]>;
  reviewStatusResult(
    token: string,
    path: string,
    options?: { signal?: AbortSignal },
  ): Promise<WorkspaceReviewStatusLoadResult>;
  /** GET `/workspace/review/diff?path=&filePath=`，返回单文件 diff 文本。 */
  reviewDiff(
    token: string,
    path: string,
    filePath: string,
    options?: { signal?: AbortSignal },
  ): Promise<string>;
  /** POST `/workspace/review/revert`，回退指定文件的工作区改动。 */
  reviewRevert(token: string, path: string, filePath: string): Promise<void>;
  /** DELETE `/workspace/entry?path=`，删除文件或目录。 */
  deleteEntry(
    token: string,
    path: string,
    options?: { sessionId?: string | null; workspaceRoot?: string | null },
  ): Promise<void>;
  /** POST `/workspace/rename`，重命名/移动文件或目录。 */
  renameEntry(
    token: string,
    oldPath: string,
    newPath: string,
    options?: { sessionId?: string | null; workspaceRoot?: string | null },
  ): Promise<void>;
  /**
   * PATCH `/sessions/:sessionId/workspace`，绑定 / 解绑会话工作目录。
   * 传 `null` 解绑。
   */
  setSessionWorkspace(
    token: string,
    sessionId: string,
    workingDirectory: string | null,
  ): Promise<SessionWorkspaceUpdateResponse>;
}

function buildPathParams(
  path: string,
  extra?: Record<string, string | number | undefined>,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set('path', path);
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined) {
        params.set(key, String(value));
      }
    }
  }
  return params;
}

function isRetryableWorkspaceStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function buildWorkspaceRootsErrorMessage(status: number, data: JsonErrorData | undefined): string {
  const extracted = extractJsonErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return '认证失效或当前账号无权读取工作区根目录。';
  }
  return `加载工作区根目录失败（HTTP ${status}）。`;
}

function buildWorkspaceTreeErrorMessage(status: number, data: JsonErrorData | undefined): string {
  const extracted = extractJsonErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return '认证失效或当前账号无权读取文件树。';
  }
  if (status === 404) {
    return '目标目录不存在或当前工作区已失效。';
  }
  return `加载文件树失败（HTTP ${status}）。`;
}

function buildWorkspaceReviewStatusErrorMessage(
  status: number,
  data: JsonErrorData | undefined,
): string {
  const extracted = extractJsonErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return '认证失效或当前账号无权读取工作区改动状态。';
  }
  return `加载工作区改动状态失败（HTTP ${status}）。`;
}

function buildWorkspaceFileErrorMessage(status: number, data: JsonErrorData | undefined): string {
  const extracted = extractJsonErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return '认证失效或当前账号无权读取文件内容。';
  }
  if (status === 404) {
    return '目标文件不存在。';
  }
  return `加载文件内容失败（HTTP ${status}）。`;
}

function buildWorkspaceActionErrorMessage(
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
    return `目标工作区资源不存在，无法${actionLabel}。`;
  }
  if (status === 409) {
    return `当前状态不允许${actionLabel}。`;
  }
  return `${actionLabel}失败（HTTP ${status}）。`;
}

function isGenericWorkspaceNetworkErrorMessage(message: string): boolean {
  return isGenericFetchErrorMessage(message);
}

function normalizeWorkspaceActionError(actionLabel: string, error: unknown): Error {
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
    if (message.length > 0 && !isGenericWorkspaceNetworkErrorMessage(message)) {
      return error;
    }
  }
  return new Error(`网络异常，${actionLabel}失败。`);
}

async function performWorkspaceJsonRequest<T>(input: {
  actionLabel: string;
  parseJson?: boolean;
  request: () => Promise<Response>;
}): Promise<T> {
  try {
    const response = await input.request();
    if (!response.ok) {
      const data = await readJsonErrorData<JsonErrorData>(response);
      throw new HttpError(
        buildWorkspaceActionErrorMessage(input.actionLabel, response.status, data),
        response.status,
        data,
      );
    }
    if (input.parseJson === false || response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  } catch (error) {
    throw normalizeWorkspaceActionError(input.actionLabel, error);
  }
}

export function createWorkspaceClient(baseUrl: string): WorkspaceClient {
  const listRootsResult = async (
    token: string,
    options?: { signal?: AbortSignal },
  ): Promise<WorkspaceRootsLoadResult> => {
    try {
      const response = await fetchWithTimeout(`${baseUrl}/workspace/root`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      if (!response.ok) {
        return {
          ok: false,
          retryable: isRetryableWorkspaceStatus(response.status),
          errorMessage: buildWorkspaceRootsErrorMessage(
            response.status,
            await readJsonErrorData<JsonErrorData>(response),
          ),
          status: response.status,
          roots: [],
        };
      }
      const data = (await response.json()) as WorkspaceRootsResponse;
      const roots = Array.isArray(data.roots)
        ? data.roots.filter((root) => typeof root === 'string' && root.length > 0)
        : typeof data.root === 'string' && data.root.length > 0
          ? [data.root]
          : [];
      return {
        ok: true,
        retryable: false,
        roots,
      };
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        errorMessage: normalizeWorkspaceActionError('加载工作区根目录', error).message,
        roots: [],
      };
    }
  };

  const fetchTreeResult = async (
    token: string,
    path: string,
    options?: { depth?: number; signal?: AbortSignal },
  ): Promise<WorkspaceTreeLoadResult> => {
    const params = buildPathParams(path, { depth: options?.depth ?? 1 });
    try {
      const response = await fetchWithTimeout(withQuery(`${baseUrl}/workspace/tree`, params), {
        headers: authHeader(token),
        signal: options?.signal,
      });
      if (!response.ok) {
        return {
          ok: false,
          retryable: isRetryableWorkspaceStatus(response.status),
          errorMessage: buildWorkspaceTreeErrorMessage(
            response.status,
            await readJsonErrorData<JsonErrorData>(response),
          ),
          status: response.status,
          nodes: [],
        };
      }
      const data = (await response.json()) as { nodes?: FileTreeNode[] } | FileTreeNode[];
      return {
        ok: true,
        retryable: false,
        nodes: Array.isArray(data) ? data : (data.nodes ?? []),
      };
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        errorMessage: normalizeWorkspaceActionError('加载文件树', error).message,
        nodes: [],
      };
    }
  };

  const reviewStatusResult = async (
    token: string,
    path: string,
    options?: { signal?: AbortSignal },
  ): Promise<WorkspaceReviewStatusLoadResult> => {
    const params = buildPathParams(path);
    try {
      const response = await fetchWithTimeout(
        withQuery(`${baseUrl}/workspace/review/status`, params),
        {
          headers: authHeader(token),
          signal: options?.signal,
        },
      );
      if (!response.ok) {
        return {
          ok: false,
          retryable: isRetryableWorkspaceStatus(response.status),
          errorMessage: buildWorkspaceReviewStatusErrorMessage(
            response.status,
            await readJsonErrorData<JsonErrorData>(response),
          ),
          status: response.status,
          changes: [],
        };
      }
      const data = (await response.json()) as WorkspaceReviewStatusResponse;
      return {
        ok: true,
        retryable: false,
        changes: data.changes ?? [],
      };
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        errorMessage: normalizeWorkspaceActionError('加载工作区改动状态', error).message,
        changes: [],
      };
    }
  };

  const readFileResult = async (
    token: string,
    path: string,
    options?: { signal?: AbortSignal; workspaceRoot?: string },
  ): Promise<WorkspaceFileLoadResult> => {
    const params = buildPathParams(path);
    if (options?.workspaceRoot) {
      params.set('workspaceRoot', options.workspaceRoot);
    }
    try {
      const response = await fetchWithTimeout(withQuery(`${baseUrl}/workspace/file`, params), {
        headers: authHeader(token),
        signal: options?.signal,
      });
      if (!response.ok) {
        return {
          ok: false,
          retryable: isRetryableWorkspaceStatus(response.status),
          errorMessage: buildWorkspaceFileErrorMessage(
            response.status,
            await readJsonErrorData<JsonErrorData>(response),
          ),
          status: response.status,
        };
      }
      return {
        ok: true,
        retryable: false,
        file: (await response.json()) as WorkspaceFileContent,
      };
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        errorMessage: normalizeWorkspaceActionError('加载文件内容', error).message,
      };
    }
  };

  return {
    async listRoots(token, options) {
      const result = await listRootsResult(token, options);
      if (!result.ok) {
        throw new HttpError(result.errorMessage ?? '加载工作区根目录失败', result.status ?? 500);
      }
      return result.roots;
    },

    listRootsResult,

    async fetchTree(token, path, options) {
      const result = await fetchTreeResult(token, path, options);
      if (!result.ok) {
        throw new HttpError(result.errorMessage ?? '加载文件树失败', result.status ?? 500);
      }
      return result.nodes;
    },

    fetchTreeResult,

    async readFile(token, path, options) {
      const result = await readFileResult(token, path, options);
      if (!result.ok || !result.file) {
        throw new HttpError(result.errorMessage ?? '加载文件内容失败', result.status ?? 500);
      }
      return result.file;
    },

    readFileResult,

    async readFileBinary(token, path, options) {
      const params = buildPathParams(path);
      if (options?.workspaceRoot) {
        params.set('workspaceRoot', options.workspaceRoot);
      }
      try {
        const response = await fetchWithTimeout(
          withQuery(`${baseUrl}/workspace/file/binary`, params),
          {
            headers: authHeader(token),
            signal: options?.signal,
          },
        );
        if (!response.ok) {
          const data = await readJsonErrorData<JsonErrorData>(response);
          throw new HttpError(
            buildWorkspaceActionErrorMessage('读取二进制文件', response.status, data),
            response.status,
            data,
          );
        }
        const buffer = await response.arrayBuffer();
        const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
        return { buffer, contentType };
      } catch (error) {
        throw normalizeWorkspaceActionError('读取二进制文件', error);
      }
    },

    async writeFile(token, path, content) {
      await performWorkspaceJsonRequest({
        actionLabel: '写入工作区文件',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/workspace/file`, {
            method: 'PUT',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify({ path, content }),
          }),
      });
    },

    async createFile(token, path, content = '') {
      await performWorkspaceJsonRequest({
        actionLabel: '创建工作区文件',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/workspace/file`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify({ path, content }),
          }),
      });
    },

    async createDirectory(token, path) {
      await performWorkspaceJsonRequest({
        actionLabel: '创建工作区目录',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/workspace/directory`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify({ path }),
          }),
      });
    },

    async validatePath(token, path) {
      const params = buildPathParams(path);
      try {
        const response = await fetchWithTimeout(
          withQuery(`${baseUrl}/workspace/validate`, params),
          {
            headers: authHeader(token),
          },
        );
        if (!response.ok) {
          return {
            valid: false,
            error: buildWorkspaceActionErrorMessage(
              '校验工作区路径',
              response.status,
              await readJsonErrorData<JsonErrorData>(response),
            ),
          };
        }
        return (await response.json()) as WorkspaceValidateResult;
      } catch (error) {
        return {
          valid: false,
          error: normalizeWorkspaceActionError('校验工作区路径', error).message,
        };
      }
    },

    async search(token, query, rootPath, options) {
      const params = new URLSearchParams();
      params.set('q', query);
      params.set('path', rootPath);
      if (options?.maxResults !== undefined) {
        params.set('maxResults', String(options.maxResults));
      }
      const data = await performWorkspaceJsonRequest<{ results?: WorkspaceSearchHit[] }>({
        actionLabel: '搜索工作区内容',
        request: () =>
          fetchWithTimeout(withQuery(`${baseUrl}/workspace/search`, params), {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
      return data.results ?? [];
    },

    async findByName(token, name, rootPath, options) {
      const params = new URLSearchParams();
      params.set('name', name);
      params.set('path', rootPath);
      if (options?.maxResults !== undefined) {
        params.set('maxResults', String(options.maxResults));
      }
      const data = await performWorkspaceJsonRequest<{ results?: Array<{ path: string }> }>({
        actionLabel: '按文件名查找工作区文件',
        request: () =>
          fetchWithTimeout(withQuery(`${baseUrl}/workspace/find-by-name`, params), {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
      return data.results ?? [];
    },

    async reviewStatus(token, path, options) {
      const result = await reviewStatusResult(token, path, options);
      if (!result.ok) {
        throw new HttpError(result.errorMessage ?? '加载工作区改动状态失败', result.status ?? 500);
      }
      return result.changes;
    },

    reviewStatusResult,

    async reviewDiff(token, path, filePath, options) {
      const params = buildPathParams(path, { filePath });
      const data = await performWorkspaceJsonRequest<WorkspaceReviewDiffResponse>({
        actionLabel: '读取工作区审阅 diff',
        request: () =>
          fetchWithTimeout(withQuery(`${baseUrl}/workspace/review/diff`, params), {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
      return data.diff ?? '';
    },

    async reviewRevert(token, path, filePath) {
      await performWorkspaceJsonRequest({
        actionLabel: '回退工作区文件改动',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/workspace/review/revert`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify({ path, filePath }),
          }),
      });
    },

    async deleteEntry(token, path, options) {
      const params = buildPathParams(path, {
        sessionId: options?.sessionId ?? undefined,
        workspaceRoot: options?.workspaceRoot ?? undefined,
      });
      await performWorkspaceJsonRequest({
        actionLabel: '删除工作区条目',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/workspace/entry?${params}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          }),
      });
    },

    async renameEntry(token, oldPath, newPath, options) {
      await performWorkspaceJsonRequest({
        actionLabel: '重命名工作区条目',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/workspace/rename`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify({
              oldPath,
              newPath,
              ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
              ...(options?.workspaceRoot ? { workspaceRoot: options.workspaceRoot } : {}),
            }),
          }),
      });
    },

    async setSessionWorkspace(token, sessionId, workingDirectory) {
      return performWorkspaceJsonRequest<SessionWorkspaceUpdateResponse>({
        actionLabel: '设置会话工作区',
        request: () =>
          fetchWithTimeout(`${baseUrl}/sessions/${sessionId}/workspace`, {
            method: 'PATCH',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify({ workingDirectory }),
          }),
      });
    },
  };
}
