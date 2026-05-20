/**
 * Snapshot Trees API Client
 * ─────────────────────────
 *
 * 前端调用 agent-gateway 的 snapshot-tree 相关 REST 端点。
 * 用于时间线面板、恢复预览、cherry-pick 等 UI。
 */

import type { FileChangeGuaranteeLevel, FileChangeSourceKind } from '@openAwork/shared';

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

export function createSnapshotTreesClient(gatewayUrl: string): SnapshotTreesClient {
  return {
    async list(token, sessionId, options) {
      const params = new URLSearchParams();
      if (options?.clientRequestId) {
        params.set('clientRequestId', options.clientRequestId);
      }
      const qs = params.toString();
      const url = `${gatewayUrl}/sessions/${sessionId}/snapshot-trees${qs ? `?${qs}` : ''}`;
      const res = await fetch(url, { headers: authHeader(token) });
      if (!res.ok) throw new Error(`snapshot-trees list failed: ${res.status}`);
      return (await res.json()) as { trees: SnapshotTreeEntry[] };
    },

    async detail(token, sessionId, treeHash) {
      const url = `${gatewayUrl}/sessions/${sessionId}/snapshot-trees/${treeHash}`;
      const res = await fetch(url, { headers: authHeader(token) });
      if (!res.ok) throw new Error(`snapshot-trees detail failed: ${res.status}`);
      return (await res.json()) as SnapshotTreeDetail;
    },

    async restoreToTree(token, sessionId, input) {
      const url = `${gatewayUrl}/sessions/${sessionId}/restore/to-tree`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`restore/to-tree failed: ${res.status}`);
      return (await res.json()) as RestoreResult;
    },

    async cherryPick(token, sessionId, input) {
      const url = `${gatewayUrl}/sessions/${sessionId}/restore/cherry-pick`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`restore/cherry-pick failed: ${res.status}`);
      return (await res.json()) as RestoreResult;
    },

    async restoreAtTime(token, sessionId, input) {
      const url = `${gatewayUrl}/sessions/${sessionId}/restore/at-time`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`restore/at-time failed: ${res.status}`);
      return (await res.json()) as RestoreResult;
    },

    async restoreFromSession(token, sessionId, input) {
      const url = `${gatewayUrl}/sessions/${sessionId}/restore/from-session`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`restore/from-session failed: ${res.status}`);
      return (await res.json()) as RestoreResult;
    },
  };
}
