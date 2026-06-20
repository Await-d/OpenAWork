import { sqliteGet } from '../infra/db.js';
import {
  extractSessionWorkingDirectory,
  parseSessionMetadataJson,
  sanitizeSessionMetadataJson,
} from './session-workspace-metadata.js';

interface SessionWorkspaceRow {
  metadata_json: string;
  team_parent_session_id: string | null;
}

export function resolveSessionWorkspacePath(input: {
  metadataJson: string;
  sessionId: string;
  userId: string;
}): string | null {
  return resolveSessionWorkspacePathRecursive({
    metadataJson: sanitizeSessionMetadataJson(input.metadataJson),
    seenSessionIds: new Set([input.sessionId]),
    sessionId: input.sessionId,
    userId: input.userId,
  });
}

function resolveSessionWorkspacePathRecursive(input: {
  metadataJson: string;
  seenSessionIds: Set<string>;
  sessionId: string;
  userId: string;
}): string | null {
  const parsedMetadata = parseSessionMetadataJson(input.metadataJson);

  const directWorkspacePath = extractSessionWorkingDirectory(parsedMetadata);
  if (directWorkspacePath) {
    return directWorkspacePath;
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

  return resolveSessionWorkspacePathRecursive({
    metadataJson: sanitizeSessionMetadataJson(parentSession.metadata_json),
    seenSessionIds: new Set([...input.seenSessionIds, parentSessionId]),
    sessionId: parentSessionId,
    userId: input.userId,
  });
}
