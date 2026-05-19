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

import { authHeader, expectJson, HttpError, jsonAuthHeaders, withQuery } from '../gateway/http.js';

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

export interface WorkspaceClient {
  /** GET `/workspace/root`，返回所有工作区根目录的 `roots` 数组（旧版本只回 `root` 字段也兼容）。 */
  listRoots(token: string, options?: { signal?: AbortSignal }): Promise<string[]>;
  /** GET `/workspace/tree?path=&depth=`，返回展开 `depth` 层的目录树。 */
  fetchTree(
    token: string,
    path: string,
    options?: { depth?: number; signal?: AbortSignal },
  ): Promise<FileTreeNode[]>;
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
  deleteEntry(token: string, path: string): Promise<void>;
  /** POST `/workspace/rename`，重命名/移动文件或目录。 */
  renameEntry(token: string, oldPath: string, newPath: string): Promise<void>;
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

export function createWorkspaceClient(baseUrl: string): WorkspaceClient {
  return {
    async listRoots(token, options) {
      const response = await fetch(`${baseUrl}/workspace/root`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      if (!response.ok) {
        throw new HttpError(`Failed to list workspace roots: ${response.status}`, response.status);
      }
      const data = (await response.json()) as WorkspaceRootsResponse;
      const roots = Array.isArray(data.roots)
        ? data.roots.filter((root) => typeof root === 'string' && root.length > 0)
        : typeof data.root === 'string' && data.root.length > 0
          ? [data.root]
          : [];
      return roots;
    },

    async fetchTree(token, path, options) {
      const params = buildPathParams(path, { depth: options?.depth ?? 1 });
      const response = await fetch(withQuery(`${baseUrl}/workspace/tree`, params), {
        headers: authHeader(token),
        signal: options?.signal,
      });
      if (!response.ok) {
        throw new HttpError(`Failed to fetch workspace tree: ${response.status}`, response.status);
      }
      const data = (await response.json()) as { nodes?: FileTreeNode[] } | FileTreeNode[];
      if (Array.isArray(data)) {
        return data;
      }
      return data.nodes ?? [];
    },

    async readFile(token, path, options) {
      const params = buildPathParams(path);
      if (options?.workspaceRoot) {
        params.set('workspaceRoot', options.workspaceRoot);
      }
      const response = await fetch(withQuery(`${baseUrl}/workspace/file`, params), {
        headers: authHeader(token),
        signal: options?.signal,
      });
      return expectJson<WorkspaceFileContent>(response, 'readFile');
    },

    async readFileBinary(token, path, options) {
      const params = buildPathParams(path);
      if (options?.workspaceRoot) {
        params.set('workspaceRoot', options.workspaceRoot);
      }
      const response = await fetch(withQuery(`${baseUrl}/workspace/file/binary`, params), {
        headers: authHeader(token),
        signal: options?.signal,
      });
      if (!response.ok) {
        throw new HttpError(`Failed to read binary: ${response.status}`, response.status);
      }
      const buffer = await response.arrayBuffer();
      const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
      return { buffer, contentType };
    },

    async writeFile(token, path, content) {
      const response = await fetch(`${baseUrl}/workspace/file`, {
        method: 'PUT',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify({ path, content }),
      });
      if (!response.ok) {
        throw new HttpError(`Failed to write workspace file: ${response.status}`, response.status);
      }
    },

    async createFile(token, path, content = '') {
      const response = await fetch(`${baseUrl}/workspace/file`, {
        method: 'POST',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify({ path, content }),
      });
      if (!response.ok) {
        throw new HttpError(`Failed to create workspace file: ${response.status}`, response.status);
      }
    },

    async createDirectory(token, path) {
      const response = await fetch(`${baseUrl}/workspace/directory`, {
        method: 'POST',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify({ path }),
      });
      if (!response.ok) {
        throw new HttpError(
          `Failed to create workspace directory: ${response.status}`,
          response.status,
        );
      }
    },

    async validatePath(token, path) {
      const params = buildPathParams(path);
      const response = await fetch(withQuery(`${baseUrl}/workspace/validate`, params), {
        headers: authHeader(token),
      });
      if (!response.ok) {
        return { valid: false, error: `Validation request failed: ${response.status}` };
      }
      return (await response.json()) as WorkspaceValidateResult;
    },

    async search(token, query, rootPath, options) {
      const params = new URLSearchParams();
      params.set('q', query);
      params.set('path', rootPath);
      if (options?.maxResults !== undefined) {
        params.set('maxResults', String(options.maxResults));
      }
      const response = await fetch(withQuery(`${baseUrl}/workspace/search`, params), {
        headers: authHeader(token),
        signal: options?.signal,
      });
      if (!response.ok) {
        throw new HttpError(`Failed to search workspace: ${response.status}`, response.status);
      }
      const data = (await response.json()) as { results?: WorkspaceSearchHit[] };
      return data.results ?? [];
    },

    async findByName(token, name, rootPath, options) {
      const params = new URLSearchParams();
      params.set('name', name);
      params.set('path', rootPath);
      if (options?.maxResults !== undefined) {
        params.set('maxResults', String(options.maxResults));
      }
      const response = await fetch(withQuery(`${baseUrl}/workspace/find-by-name`, params), {
        headers: authHeader(token),
        signal: options?.signal,
      });
      if (!response.ok) {
        throw new HttpError(`Failed to find file by name: ${response.status}`, response.status);
      }
      const data = (await response.json()) as { results?: Array<{ path: string }> };
      return data.results ?? [];
    },

    async reviewStatus(token, path, options) {
      const params = buildPathParams(path);
      const response = await fetch(withQuery(`${baseUrl}/workspace/review/status`, params), {
        headers: authHeader(token),
        signal: options?.signal,
      });
      if (!response.ok) {
        throw new HttpError(`Failed to load review status: ${response.status}`, response.status);
      }
      const data = (await response.json()) as WorkspaceReviewStatusResponse;
      return data.changes ?? [];
    },

    async reviewDiff(token, path, filePath, options) {
      const params = buildPathParams(path, { filePath });
      const response = await fetch(withQuery(`${baseUrl}/workspace/review/diff`, params), {
        headers: authHeader(token),
        signal: options?.signal,
      });
      if (!response.ok) {
        throw new HttpError(`Failed to load review diff: ${response.status}`, response.status);
      }
      const data = (await response.json()) as WorkspaceReviewDiffResponse;
      return data.diff ?? '';
    },

    async reviewRevert(token, path, filePath) {
      const response = await fetch(`${baseUrl}/workspace/review/revert`, {
        method: 'POST',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify({ path, filePath }),
      });
      if (!response.ok) {
        throw new HttpError(`Failed to revert workspace file: ${response.status}`, response.status);
      }
    },

    async deleteEntry(token, path) {
      const params = buildPathParams(path);
      const response = await fetch(`${baseUrl}/workspace/entry?${params}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new HttpError(data?.error ?? `Failed to delete: ${response.status}`, response.status);
      }
    },

    async renameEntry(token, oldPath, newPath) {
      const response = await fetch(`${baseUrl}/workspace/rename`, {
        method: 'POST',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify({ oldPath, newPath }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new HttpError(data?.error ?? `Failed to rename: ${response.status}`, response.status);
      }
    },

    async setSessionWorkspace(token, sessionId, workingDirectory) {
      const response = await fetch(`${baseUrl}/sessions/${sessionId}/workspace`, {
        method: 'PATCH',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify({ workingDirectory }),
      });
      const data = (await response.json().catch(() => null)) as
        | (SessionWorkspaceUpdateResponse & { error?: string })
        | null;
      if (!response.ok) {
        throw new HttpError(
          data?.error ?? `Failed to set session workspace: ${response.status}`,
          response.status,
          data ?? undefined,
        );
      }
      return data ?? {};
    },
  };
}
