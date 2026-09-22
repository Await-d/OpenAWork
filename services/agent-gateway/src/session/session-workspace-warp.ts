/**
 * 会话工作区 warp：把会话绑定/切换到新的工作目录，或解绑当前工作区。
 *
 * 从 `PATCH /sessions/:sessionId/workspace` 路由中抽取，供 HTTP 路由与
 * `session_move` 工具复用，语义保持不变（P3-WARP stage 0，workflow 260509）：
 * 默认仍受「首次绑定后不可变」锁保护，只有显式 `force: true` 才能强制切换，
 * 且强制切换会写入 `metadata.workspaceWarpHistory` 审计。
 */
import { sqliteGet, sqliteRun } from '../infra/db.js';
import { getSshService } from '../ssh/ssh-service.js';
import { invalidateUserWorkspaceAllowlist } from '../workspace/user-workspace-allowlist.js';
import { validateWorkspacePath } from '../workspace/workspace-paths.js';
import {
  extractSessionSshConnectionId,
  extractSessionWorkingDirectory,
  isSessionWorkspaceRebindingAttempt,
  parseSessionMetadataJson,
} from './session-workspace-metadata.js';

export const SESSION_WORKSPACE_IMMUTABLE_ERROR = '当前会话已绑定工作区，不能直接修改。';

/** `metadata.workspaceWarpHistory` 的保留上限，防止失控增长。 */
const WORKSPACE_WARP_HISTORY_LIMIT = 50;

interface SessionWorkspaceRow {
  id: string;
  metadata_json: string;
}

export type SessionWorkspaceWarpResult =
  | { kind: 'not_found' }
  | { kind: 'forbidden_path' }
  | { kind: 'immutable' }
  | { kind: 'unchanged'; workingDirectory: string | null }
  | { kind: 'warped'; workingDirectory: string | null; forced: boolean };

export interface WarpSessionWorkspaceInput {
  sessionId: string;
  userId: string;
  /** 目标工作目录；`null` 表示解绑当前工作区。 */
  workingDirectory: string | null;
  /** `true` 时允许强制切换已绑定工作区，并写入 warp 审计。 */
  force: boolean;
  /** SSH 解绑失败时的告警回调；缺省回退到 `console.warn`。 */
  onSshUnbindWarning?: (error: unknown) => void;
}

function warnSshUnbindFailure(error: unknown, onWarning?: (error: unknown) => void): void {
  if (onWarning) {
    onWarning(error);
    return;
  }
  console.warn(
    `[session-workspace-warp] ssh unbind failed: ${error instanceof Error ? error.message : String(error)}`,
  );
}

export function warpSessionWorkspace(input: WarpSessionWorkspaceInput): SessionWorkspaceWarpResult {
  const session = sqliteGet<SessionWorkspaceRow>(
    'SELECT id, metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [input.sessionId, input.userId],
  );
  if (!session) {
    return { kind: 'not_found' };
  }

  const metadata = parseSessionMetadataJson(session.metadata_json);
  const currentWorkingDirectory = extractSessionWorkingDirectory(metadata);
  // SSH 会话语义：warp 目标只能是「本地目录」或「解绑」——这两种操作都意味着
  // 离开 SSH 工作区，因此成功后同步清除 sshConnectionId 并解绑。
  const currentSshConnectionId = extractSessionSshConnectionId(metadata);
  const isSshSession = currentSshConnectionId !== null;
  const isForcedWarp = input.force;

  let safeWorkingDirectory: string | null = null;
  if (input.workingDirectory === null) {
    if (!isForcedWarp && !isSshSession && isSessionWorkspaceRebindingAttempt(metadata, null)) {
      return { kind: 'immutable' };
    }
    delete metadata['workingDirectory'];
    if (isSshSession) {
      delete metadata['sshConnectionId'];
    }
  } else {
    safeWorkingDirectory = validateWorkspacePath(input.workingDirectory);
    if (!safeWorkingDirectory) {
      return { kind: 'forbidden_path' };
    }
    if (
      !isForcedWarp &&
      !isSshSession &&
      isSessionWorkspaceRebindingAttempt(metadata, safeWorkingDirectory)
    ) {
      return { kind: 'immutable' };
    }
    metadata['workingDirectory'] = safeWorkingDirectory;
    if (isSshSession) {
      delete metadata['sshConnectionId'];
    }
  }

  if (currentWorkingDirectory === safeWorkingDirectory) {
    return { kind: 'unchanged', workingDirectory: currentWorkingDirectory };
  }

  // 仅在接受强制重绑时追加 warp 审计；畸形 history 视为空数组，绝不抛错。
  if (isForcedWarp && currentWorkingDirectory !== null) {
    const existing = metadata['workspaceWarpHistory'];
    const history = Array.isArray(existing) ? [...existing] : [];
    history.push({
      from: currentWorkingDirectory,
      to: safeWorkingDirectory,
      at: new Date().toISOString(),
    });
    metadata['workspaceWarpHistory'] = history.slice(-WORKSPACE_WARP_HISTORY_LIMIT);
  }

  sqliteRun(
    "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [JSON.stringify(metadata), input.sessionId, input.userId],
  );

  // 离开 SSH 工作区后解除会话↔连接绑定（内存 registry + 持久层），
  // 避免后续工具调用继续被路由到远端。best-effort，不阻断 warp 结果。
  if (currentSshConnectionId) {
    try {
      getSshService().unbindSession(input.userId, input.sessionId);
    } catch (error) {
      warnSshUnbindFailure(error, input.onSshUnbindWarning);
    }
  }

  // Workspace warp 可能引入新的工作目录，刷新 per-user allowlist 缓存。
  invalidateUserWorkspaceAllowlist(input.userId);

  return { kind: 'warped', workingDirectory: safeWorkingDirectory, forced: isForcedWarp };
}
