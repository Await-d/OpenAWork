/**
 * Workspace context snapshot — 会话级冻结 `buildWorkspaceContext` 的输出。
 *
 * 背景：`buildWorkspaceContext` 会读取工作区根目录列表 + AGENTS.md / README /
 * 规则文件，并渲染进 **stable system 段**。它此前在每次请求重新读取：开发任务里
 * 一旦新增/删除根级文件、或编辑 AGENTS.md，stable 前缀字节就会变化，导致
 * 「工具定义 + 全部 system 段」的 prompt-cache 前缀整段失效（表现为某一轮
 * fresh input 突然暴涨）。
 *
 * 对齐参考库 opencode v2.0.15 的 instructions 语义：会话开始时形成**基线**，
 * 会话内不再重渲染可变的指令前缀（参考库把后续变化作为增量消息追加；本仓先做
 * 基线冻结这一半）。工作区内容变化从**下一个会话**开始生效；会话内需要最新
 * 目录时模型仍可调用 `list` / `glob`。
 *
 * 开关：`OPENAWORK_DISABLE_WORKSPACE_CTX_FREEZE=1` 回退为每请求重建。
 */

import { sqliteGet, sqliteRun } from '../infra/db.js';

export const WORKSPACE_CTX_SNAPSHOT_KEY = 'workspaceCtxSnapshot';

export interface WorkspaceContextSnapshot {
  readonly workspacePath: string | null;
  readonly content: string;
  readonly createdAt: number;
}

/** 冻结开关（默认开启）；显式置 1/true 时回退每请求重建。 */
export function isWorkspaceContextFreezeDisabled(): boolean {
  const raw = globalThis.process?.env?.['OPENAWORK_DISABLE_WORKSPACE_CTX_FREEZE'];
  if (typeof raw !== 'string') return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function readMetadata(sessionId: string, userId: string): Record<string, unknown> | null {
  const row = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ?',
    [sessionId, userId],
  );
  if (!row?.metadata_json) return null;
  try {
    const parsed = JSON.parse(row.metadata_json) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function readWorkspaceContextSnapshot(
  sessionId: string,
  userId: string,
): WorkspaceContextSnapshot | null {
  const metadata = readMetadata(sessionId, userId);
  const value = metadata?.[WORKSPACE_CTX_SNAPSHOT_KEY];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const content = record['content'];
  if (typeof content !== 'string' || content.trim().length === 0) return null;
  return {
    workspacePath: typeof record['workspacePath'] === 'string' ? record['workspacePath'] : null,
    content,
    createdAt: typeof record['createdAt'] === 'number' ? record['createdAt'] : 0,
  };
}

export function writeWorkspaceContextSnapshot(
  sessionId: string,
  userId: string,
  snapshot: WorkspaceContextSnapshot,
): void {
  const metadata = readMetadata(sessionId, userId);
  if (metadata === null) return;
  metadata[WORKSPACE_CTX_SNAPSHOT_KEY] = snapshot;
  sqliteRun('UPDATE sessions SET metadata_json = ? WHERE id = ? AND user_id = ?', [
    JSON.stringify(metadata),
    sessionId,
    userId,
  ]);
}

/**
 * 读取冻结的 workspace ctx；没有快照（或工作区路径变化）时调用 `build` 生成并落库。
 *
 * - `build()` 返回 null（未绑定工作区等）时不写快照，保持每次重试；
 * - 工作区路径变化（会话迁移 / 重新绑定）视为失效，重建并覆盖快照。
 */
export async function resolveFrozenWorkspaceContext(input: {
  sessionId: string;
  userId: string;
  workspacePath: string | null;
  build: () => Promise<string | null>;
}): Promise<string | null> {
  if (isWorkspaceContextFreezeDisabled()) {
    return input.build();
  }
  const snapshot = readWorkspaceContextSnapshot(input.sessionId, input.userId);
  if (snapshot && snapshot.workspacePath === input.workspacePath) {
    return snapshot.content;
  }
  const built = await input.build();
  if (built === null || built.trim().length === 0) {
    return built;
  }
  writeWorkspaceContextSnapshot(input.sessionId, input.userId, {
    workspacePath: input.workspacePath,
    content: built,
    createdAt: Date.now(),
  });
  return built;
}
