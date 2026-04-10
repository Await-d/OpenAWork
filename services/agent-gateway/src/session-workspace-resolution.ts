import { sqliteGet } from './db.js';
import {
  extractSessionWorkingDirectory,
  parseSessionMetadataJson,
  sanitizeSessionMetadataJson,
} from './session-workspace-metadata.js';

interface SessionWorkspaceRow {
  metadata_json: string;
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
  const directWorkspacePath = extractSessionWorkingDirectory(
    parseSessionMetadataJson(input.metadataJson),
  );
  if (directWorkspacePath) {
    return directWorkspacePath;
  }

  const parentSessionId = parseSessionMetadataJson(input.metadataJson)['parentSessionId'];
  if (typeof parentSessionId !== 'string' || parentSessionId.length === 0) {
    return null;
  }

  if (input.seenSessionIds.has(parentSessionId)) {
    return null;
  }

  const parentSession = sqliteGet<SessionWorkspaceRow>(
    'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
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
