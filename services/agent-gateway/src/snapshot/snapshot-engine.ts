/**
 * SnapshotEngine
 * ──────────────
 *
 * 对调用方（stream runtime / restore routes）提供统一的快照 API，
 * 在 shadow git 可用时使用 git，不可用时优雅降级到现有的
 * `session-file-backup-store`。
 *
 * 关键能力：
 *  - capture：原子捕获工作区状态，返回 SnapshotRef
 *  - diff：计算两个 SnapshotRef 之间的变更
 *  - readFileAt：按 SnapshotRef 读取文件内容（preview 用）
 *  - restoreSelective：选择性恢复文件
 *  - guarantee level：根据后端可用性返回 strong / medium
 *
 * 设计文档：docs/design/ultra-file-change-tracking.md
 */

import type { FileChangeGuaranteeLevel, FileDiffContent } from '@openAwork/shared';

import {
  createShadowGitStore,
  type ShadowGitFileDiff,
  type ShadowGitStore,
  type TreeHash,
} from './shadow-git-store.js';

// ─── 类型 ──────────────────────────────────────────────────────────────

/**
 * SnapshotRef: 跨后端的统一快照引用。
 *
 * - shadow git 后端：`{ kind: 'git', hash: TreeHash }`
 * - fallback：`{ kind: 'legacy', requestId: string }`（指向 session_file_diffs 中的历史记录）
 */
export type SnapshotRef = { kind: 'git'; hash: TreeHash } | { kind: 'legacy'; requestId: string };

export interface SnapshotEngineCaptureInput {
  workspaceRoot: string;
  files?: string[];
}

export interface SnapshotEngineDiffInput {
  workspaceRoot: string;
  from: SnapshotRef;
  to: SnapshotRef;
}

export interface SnapshotEngineRestoreInput {
  workspaceRoot: string;
  snapshot: SnapshotRef;
  files?: string[];
  deleteMissing?: boolean;
}

export interface SnapshotEngineReadFileInput {
  workspaceRoot: string;
  snapshot: SnapshotRef;
  filePath: string;
}

export interface SnapshotCaptureResult {
  ref: SnapshotRef;
  guaranteeLevel: FileChangeGuaranteeLevel;
  /** 当前后端类型（git | legacy） */
  backend: 'git' | 'legacy' | 'noop';
}

export interface SnapshotEngine {
  /** 当前后端是否启用 git。可用于 routes 决定 guarantee level。 */
  isShadowGitEnabled(): Promise<boolean>;

  capture(input: SnapshotEngineCaptureInput): Promise<SnapshotCaptureResult>;

  /** 计算两个快照之间的 file diff（含 before/after 内容） */
  diff(input: SnapshotEngineDiffInput): Promise<FileDiffContent[]>;

  /** 读取指定快照中的文件内容；不存在返回 null */
  readFileAt(input: SnapshotEngineReadFileInput): Promise<string | null>;

  /** 选择性恢复多个文件到指定快照 */
  restoreSelective(input: SnapshotEngineRestoreInput): Promise<void>;

  /** 工作区维护 */
  gc(workspaceRoot: string): Promise<void>;
}

// ─── 实现 ──────────────────────────────────────────────────────────────

class SnapshotEngineImpl implements SnapshotEngine {
  private readonly shadow: ShadowGitStore;
  private resolvedAvailability: boolean | undefined;

  constructor(shadow: ShadowGitStore = createShadowGitStore()) {
    this.shadow = shadow;
  }

  async isShadowGitEnabled(): Promise<boolean> {
    if (this.resolvedAvailability !== undefined) return this.resolvedAvailability;
    this.resolvedAvailability = await this.shadow.isAvailable();
    return this.resolvedAvailability;
  }

  async capture(input: SnapshotEngineCaptureInput): Promise<SnapshotCaptureResult> {
    if (!(await this.isShadowGitEnabled())) {
      // Fallback：legacy 后端不在这里写文件，由调用方继续使用
      // session-file-backup-store + session-file-diff-store 路径。
      // 我们返回一个 noop ref，让调用方走旧路径。
      return {
        ref: { kind: 'legacy', requestId: '' },
        guaranteeLevel: 'medium',
        backend: 'noop',
      };
    }

    try {
      const hash = await this.shadow.capture(input.workspaceRoot, {
        ...(input.files ? { files: input.files } : {}),
      });
      return {
        ref: { kind: 'git', hash },
        guaranteeLevel: 'strong',
        backend: 'git',
      };
    } catch (error) {
      // 捕获失败 → 降级为 noop，让旧路径接管
      console.warn('[snapshot-engine] capture failed, falling back:', errorMessage(error));
      return {
        ref: { kind: 'legacy', requestId: '' },
        guaranteeLevel: 'medium',
        backend: 'noop',
      };
    }
  }

  async diff(input: SnapshotEngineDiffInput): Promise<FileDiffContent[]> {
    if (input.from.kind !== 'git' || input.to.kind !== 'git') {
      throw new Error('SnapshotEngine.diff currently requires both refs to be git-backed');
    }

    if (input.from.hash === input.to.hash) return [];

    const diffs = await this.shadow.diffFull(input.workspaceRoot, input.from.hash, input.to.hash);
    return diffs.map((diff) => mapShadowDiffToContent(diff));
  }

  async readFileAt(input: SnapshotEngineReadFileInput): Promise<string | null> {
    if (input.snapshot.kind !== 'git') return null;
    return this.shadow.readFileAt(input.workspaceRoot, input.snapshot.hash, input.filePath);
  }

  async restoreSelective(input: SnapshotEngineRestoreInput): Promise<void> {
    if (input.snapshot.kind !== 'git') {
      throw new Error('SnapshotEngine.restoreSelective requires a git-backed snapshot');
    }
    if (!input.files || input.files.length === 0) return;
    await this.shadow.restoreSelective(input.workspaceRoot, input.snapshot.hash, input.files, {
      deleteMissing: input.deleteMissing ?? false,
    });
  }

  async gc(workspaceRoot: string): Promise<void> {
    if (!(await this.isShadowGitEnabled())) return;
    await this.shadow.gc(workspaceRoot);
  }
}

// ─── 单例 ──────────────────────────────────────────────────────────────

let singleton: SnapshotEngineImpl | null = null;

export function getSnapshotEngine(): SnapshotEngine {
  if (!singleton) singleton = new SnapshotEngineImpl();
  return singleton;
}

export function __resetSnapshotEngineForTests(): void {
  singleton = null;
}

// ─── 辅助 ──────────────────────────────────────────────────────────────

function mapShadowDiffToContent(diff: ShadowGitFileDiff): FileDiffContent {
  return {
    file: diff.file,
    before: diff.before,
    after: diff.after,
    additions: diff.additions,
    deletions: diff.deletions,
    status: diff.status,
    sourceKind: 'session_snapshot',
    guaranteeLevel: 'strong',
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
