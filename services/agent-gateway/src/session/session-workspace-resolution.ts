import { sqliteGet } from '../infra/db.js';
import {
  extractSessionSshConnectionId,
  extractSessionWorkingDirectory,
  parseSessionMetadataJson,
  sanitizeSessionMetadataJson,
} from './session-workspace-metadata.js';

interface SessionWorkspaceRow {
  metadata_json: string;
  team_parent_session_id: string | null;
}

/**
 * 会话工作目录解析结果。
 *
 * `remote` 表示路径来源会话绑定了 SSH 连接：此时 `path` 的语义是**远端主机上的
 * 绝对路径**，任何本地文件系统调用（任务图落盘、ignore 规则加载等）都不能直接
 * 使用它 —— 见 `task-graph-root.ts` 的远端分支（否则会把 `/.agentdocs` 之类的
 * 路径写到网关本机根目录，触发 EACCES）。
 */
export interface SessionWorkspaceResolution {
  path: string;
  remote: boolean;
}

export function resolveSessionWorkspacePath(input: {
  metadataJson: string;
  sessionId: string;
  userId: string;
}): string | null {
  return resolveSessionWorkspaceResolution(input)?.path ?? null;
}

export function resolveSessionWorkspaceResolution(input: {
  metadataJson: string;
  sessionId: string;
  userId: string;
}): SessionWorkspaceResolution | null {
  return resolveSessionWorkspaceResolutionRecursive({
    metadataJson: sanitizeSessionMetadataJson(input.metadataJson),
    seenSessionIds: new Set([input.sessionId]),
    sessionId: input.sessionId,
    userId: input.userId,
  });
}

function resolveSessionWorkspaceResolutionRecursive(input: {
  metadataJson: string;
  seenSessionIds: Set<string>;
  sessionId: string;
  userId: string;
}): SessionWorkspaceResolution | null {
  const parsedMetadata = parseSessionMetadataJson(input.metadataJson);

  const directWorkspacePath = extractSessionWorkingDirectory(parsedMetadata);
  if (directWorkspacePath) {
    // `remote` 取「提供该路径的会话」自身的绑定：子会话可能不带 sshConnectionId
    // 而沿父链继承，此时真正决定路径语义的是父会话那一层。
    return {
      path: directWorkspacePath,
      remote: extractSessionSshConnectionId(parsedMetadata) !== null,
    };
  }

  // 优先从 DB 列 team_parent_session_id 获取父 session（team session 创建时
  // 父子关系写入 DB 列而非 metadata JSON）。回退到 metadata 中的 parentSessionId
  // 字段（chat session 或旧数据可能使用此字段）。
  const sessionRow = sqliteGet<SessionWorkspaceRow>(
    'SELECT metadata_json, team_parent_session_id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [input.sessionId, input.userId],
  );
  const dbParentSessionId = sessionRow?.team_parent_session_id ?? null;
  const metadataParentSessionId = parsedMetadata['parentSessionId'];
  const parentSessionId =
    typeof dbParentSessionId === 'string' && dbParentSessionId.length > 0
      ? dbParentSessionId
      : typeof metadataParentSessionId === 'string' && metadataParentSessionId.length > 0
        ? metadataParentSessionId
        : null;

  if (!parentSessionId) {
    return null;
  }

  if (input.seenSessionIds.has(parentSessionId)) {
    return null;
  }

  const parentSession = sqliteGet<SessionWorkspaceRow>(
    'SELECT metadata_json, team_parent_session_id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [parentSessionId, input.userId],
  );
  if (!parentSession) {
    return null;
  }

  return resolveSessionWorkspaceResolutionRecursive({
    metadataJson: sanitizeSessionMetadataJson(parentSession.metadata_json),
    seenSessionIds: new Set([...input.seenSessionIds, parentSessionId]),
    sessionId: parentSessionId,
    userId: input.userId,
  });
}
