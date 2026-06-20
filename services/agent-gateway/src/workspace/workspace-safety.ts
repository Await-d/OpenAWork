import { resolve } from 'node:path';
import { defaultIgnoreManager } from '@openAwork/agent-core';
import {
  hasWorkspacePersistentPermission,
  loadWorkspacePermissionConfig,
  upsertWorkspacePermanentPermission,
  writeWorkspacePermissionConfig,
} from '@openAwork/agent-core';
import { WORKSPACE_ROOT, WORKSPACE_ROOTS, sqliteGet } from '../infra/db.js';
import { resolveSessionWorkspacePath } from '../session/session-workspace-resolution.js';

interface SessionMetadataRow {
  metadata_json: string;
  user_id: string;
}

const ignoreLoadCache = new Map<string, Promise<void>>();

function resolveWorkspaceRootForPath(path: string | null | undefined): string {
  if (!path) {
    return WORKSPACE_ROOT;
  }
  const normalized = resolve(path);
  const matched = [...WORKSPACE_ROOTS]
    .sort((left, right) => right.length - left.length)
    .find((root) => normalized === root || normalized.startsWith(`${root}/`));
  return matched ?? WORKSPACE_ROOT;
}

export function getSessionWorkspaceRoot(sessionId: string): string | null {
  const row = sqliteGet<SessionMetadataRow>(
    'SELECT metadata_json, user_id FROM sessions WHERE id = ? LIMIT 1',
    [sessionId],
  );
  if (!row) {
    return null;
  }
  // 递归解析 workingDirectory：子 session 可能没有直接设置，
  // 需要通过 DB 列 team_parent_session_id 向上查找父 session 链。
  const workingDirectory = resolveSessionWorkspacePath({
    metadataJson: row.metadata_json,
    sessionId,
    userId: row.user_id,
  });
  return resolveWorkspaceRootForPath(workingDirectory);
}

export async function ensureIgnoreRulesLoadedForPath(path?: string | null): Promise<void> {
  const workspaceRoot = resolveWorkspaceRootForPath(path);
  const cached = ignoreLoadCache.get(workspaceRoot);
  if (cached) {
    await cached;
    return;
  }
  const loadPromise = defaultIgnoreManager.loadRules(workspaceRoot).then(() => undefined);
  ignoreLoadCache.set(workspaceRoot, loadPromise);
  await loadPromise;
}

export function hasWorkspacePermanentPermission(
  sessionId: string,
  toolName: string,
  scope: string,
): boolean {
  const workspaceRoot = getSessionWorkspaceRoot(sessionId);
  if (!workspaceRoot) {
    return false;
  }
  return hasWorkspacePersistentPermission(
    loadWorkspacePermissionConfig(workspaceRoot),
    toolName,
    scope,
  );
}

export function persistWorkspacePermanentPermission(input: {
  sessionId: string;
  toolName: string;
  scope: string;
}): void {
  const workspaceRoot = getSessionWorkspaceRoot(input.sessionId);
  if (!workspaceRoot) {
    return;
  }
  const next = upsertWorkspacePermanentPermission(loadWorkspacePermissionConfig(workspaceRoot), {
    toolName: input.toolName,
    scope: input.scope,
  });
  writeWorkspacePermissionConfig(workspaceRoot, next);
}
