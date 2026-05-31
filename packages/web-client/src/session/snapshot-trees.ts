/**
 * Snapshot Trees API Client
 * ─────────────────────────
 *
 * 前端调用 agent-gateway 的 snapshot-tree 相关 REST 端点。
 * 用于时间线面板、恢复预览、cherry-pick 等 UI。
 */

import type { FileChangeGuaranteeLevel, FileChangeSourceKind } from '@openAwork/shared';
import {
  extractJsonErrorMessage,
  HttpError,
  isGenericFetchErrorMessage,
  readJsonErrorData,
  type JsonErrorData,
  fetchWithTimeout,
} from '../gateway/http.js';

// ─── 类型 ──────────────────────────────────────────────────────────────

export type SnapshotTreeScopeKind = 'baseline' | 'step' | 'turn' | 'restore' | 'manual';

export interface SnapshotTreeEntry {
  treeHash: string;
  parentTreeHash: string | null;
  clientRequestId: string | null;
  scopeKind: SnapshotTreeScopeKind;
  sourceKind: FileChangeSourceKind;
  guaranteeLevel: FileChangeGuaranteeLevel;
  filesChanged: number;
  additions: number;
  deletions: number;
  toolName: string | null;
  toolCallId: string | null;
  createdAt: string;
}

export interface SnapshotTreeFileEntry {
  filePath: string;
  status: 'added' | 'deleted' | 'modified';
  additions: number;
  deletions: number;
}

export interface SnapshotTreeChainNode {
  treeHash: string;
  parentTreeHash: string | null;
  scopeKind: SnapshotTreeScopeKind;
  createdAt: string;
}

export interface SnapshotTreeDetail {
  tree: SnapshotTreeEntry;
  files: SnapshotTreeFileEntry[];
  chain: SnapshotTreeChainNode[];
}

export interface RestorePreviewFile {
  filePath: string;
  currentExists: boolean;
  targetExists: boolean;
  changed: boolean;
  additions?: number;
  deletions?: number;
  status?: 'added' | 'deleted' | 'modified';
  /** cherry-pick 模式下，该文件恢复到的目标 hash */
  targetHash?: string;
}

export interface RestorePreviewResult {
  mode: 'preview';
  treeHash?: string;
  files: RestorePreviewFile[];
  summary: {
    total: number;
    changed: number;
    additions: number;
    deletions: number;
  };
  /** cherry-pick 模式下返回 */
  keep?: string[];
  revert?: string[];
  /** from-session 模式下返回 */
  sourceSessionId?: string;
}

export interface RestoreApplyResult {
  mode: 'apply';
  treeHash?: string;
  files: string[];
  changed: number;
  afterTreeHash: string | null;
  keep?: string[];
  revert?: string[];
  sourceSessionId?: string;
}

export type RestoreResult = RestorePreviewResult | RestoreApplyResult;

// ─── Client ────────────────────────────────────────────────────────────

export interface SnapshotTreesClient {
  /** 列出 session 的所有 snapshot trees */
  list(
    token: string,
    sessionId: string,
    options?: { clientRequestId?: string },
  ): Promise<{ trees: SnapshotTreeEntry[] }>;

  /** 获取单个 tree 的详情（含文件列表和 parent 链） */
  detail(token: string, sessionId: string, treeHash: string): Promise<SnapshotTreeDetail>;

  /** 恢复到指定 tree（preview / apply） */
  restoreToTree(
    token: string,
    sessionId: string,
    input: {
      treeHash: string;
      mode: 'preview' | 'apply';
      files?: string[];
      deleteMissing?: boolean;
    },
  ): Promise<RestoreResult>;

  /** Cherry-pick 恢复（保留某些 step + 回滚其他） */
  cherryPick(
    token: string,
    sessionId: string,
    input: {
      keep: string[];
      revert: string[];
      mode: 'preview' | 'apply';
      deleteMissing?: boolean;
    },
  ): Promise<RestoreResult>;

  /** 恢复到指定时间点 */
  restoreAtTime(
    token: string,
    sessionId: string,
    input: {
      timestamp: string;
      mode: 'preview' | 'apply';
      files?: string[];
      deleteMissing?: boolean;
    },
  ): Promise<RestoreResult>;

  /** 从另一个 session 恢复 */
  restoreFromSession(
    token: string,
    sessionId: string,
    input: {
      sourceSessionId: string;
      treeHash: string;
      mode: 'preview' | 'apply';
      files?: string[];
      deleteMissing?: boolean;
    },
  ): Promise<RestoreResult>;
}

// ─── 实现 ──────────────────────────────────────────────────────────────

function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

function buildSnapshotTreesActionErrorMessage(
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
    return `目标快照树资源不存在，无法${actionLabel}。`;
  }
  if (status === 409) {
    return `当前状态不允许${actionLabel}。`;
  }
  return `${actionLabel}失败（HTTP ${status}）。`;
}

function isGenericSnapshotTreesNetworkErrorMessage(message: string): boolean {
  return isGenericFetchErrorMessage(message);
}

function normalizeSnapshotTreesError(actionLabel: string, error: unknown): Error {
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
    if (message.length > 0 && !isGenericSnapshotTreesNetworkErrorMessage(message)) {
      return error;
    }
  }
  return new Error(`网络异常，${actionLabel}失败。`);
}

async function performSnapshotTreesRequest<T>(input: {
  actionLabel: string;
  request: () => Promise<Response>;
}): Promise<T> {
  try {
    const res = await input.request();
    if (!res.ok) {
      const data = await readJsonErrorData<JsonErrorData>(res);
      throw new HttpError(
        buildSnapshotTreesActionErrorMessage(input.actionLabel, res.status, data),
        res.status,
        data,
      );
    }
    return (await res.json()) as T;
  } catch (error) {
    throw normalizeSnapshotTreesError(input.actionLabel, error);
  }
}

export function createSnapshotTreesClient(gatewayUrl: string): SnapshotTreesClient {
  return {
    async list(token, sessionId, options) {
      const params = new URLSearchParams();
      if (options?.clientRequestId) {
        params.set('clientRequestId', options.clientRequestId);
      }
      const qs = params.toString();
      const url = `${gatewayUrl}/sessions/${sessionId}/snapshot-trees${qs ? `?${qs}` : ''}`;
      return performSnapshotTreesRequest<{ trees: SnapshotTreeEntry[] }>({
        actionLabel: '读取快照树列表',
        request: () => fetchWithTimeout(url, { headers: authHeader(token) }),
      });
    },

    async detail(token, sessionId, treeHash) {
      const url = `${gatewayUrl}/sessions/${sessionId}/snapshot-trees/${treeHash}`;
      return performSnapshotTreesRequest<SnapshotTreeDetail>({
        actionLabel: '读取快照树详情',
        request: () => fetchWithTimeout(url, { headers: authHeader(token) }),
      });
    },

    async restoreToTree(token, sessionId, input) {
      const url = `${gatewayUrl}/sessions/${sessionId}/restore/to-tree`;
      return performSnapshotTreesRequest<RestoreResult>({
        actionLabel: '恢复到指定快照树',
        request: () =>
          fetchWithTimeout(url, {
            method: 'POST',
            headers: { ...authHeader(token), 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
          }),
      });
    },

    async cherryPick(token, sessionId, input) {
      const url = `${gatewayUrl}/sessions/${sessionId}/restore/cherry-pick`;
      return performSnapshotTreesRequest<RestoreResult>({
        actionLabel: 'Cherry-pick 恢复快照树',
        request: () =>
          fetchWithTimeout(url, {
            method: 'POST',
            headers: { ...authHeader(token), 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
          }),
      });
    },

    async restoreAtTime(token, sessionId, input) {
      const url = `${gatewayUrl}/sessions/${sessionId}/restore/at-time`;
      return performSnapshotTreesRequest<RestoreResult>({
        actionLabel: '按时间点恢复快照树',
        request: () =>
          fetchWithTimeout(url, {
            method: 'POST',
            headers: { ...authHeader(token), 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
          }),
      });
    },

    async restoreFromSession(token, sessionId, input) {
      const url = `${gatewayUrl}/sessions/${sessionId}/restore/from-session`;
      return performSnapshotTreesRequest<RestoreResult>({
        actionLabel: '从其他会话恢复快照树',
        request: () =>
          fetchWithTimeout(url, {
            method: 'POST',
            headers: { ...authHeader(token), 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
          }),
      });
    },
  };
}
