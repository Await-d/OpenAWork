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
import { parseSessionMetadataJson } from '../session/session-workspace-metadata.js';
import {
  assertWorkspacePathSupportedByCurrentHost,
  isPathWithinRoot,
  resolveWorkspaceEntryPath,
  validateWorkspacePath,
} from './workspace-paths.js';

interface SessionMetadataRow {
  metadata_json: string;
  user_id: string;
}

interface SessionWorkspacePolicyRow extends SessionMetadataRow {
  role_layer: string | null;
  team_parent_session_id: string | null;
}

const ignoreLoadCache = new Map<string, Promise<void>>();

function resolveWorkspaceRootForPath(path: string | null | undefined): string {
  if (!path) {
    return WORKSPACE_ROOT;
  }
  const normalized = resolve(path);
  const matched = [...WORKSPACE_ROOTS]
    .sort((left, right) => right.length - left.length)
    .find((root) => isPathWithinRoot(normalized, root));
  return matched ?? WORKSPACE_ROOT;
}

export function getSessionWorkingDirectory(sessionId: string): string | null {
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
  return workingDirectory;
}

export function getSessionWorkingDirectoryForUser(
  sessionId: string,
  userId: string,
): string | null {
  const row = sqliteGet<SessionMetadataRow>(
    'SELECT metadata_json, user_id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [sessionId, userId],
  );
  if (!row) {
    return null;
  }
  return resolveSessionWorkspacePath({
    metadataJson: row.metadata_json,
    sessionId,
    userId,
  });
}

export function getSessionWorkspaceRoot(sessionId: string): string | null {
  const workingDirectory = getSessionWorkingDirectory(sessionId);
  if (!workingDirectory) {
    return null;
  }
  return resolveWorkspaceRootForPath(workingDirectory);
}

export function requiresBoundSessionWorkspace(sessionId: string): boolean {
  const row = sqliteGet<SessionWorkspacePolicyRow>(
    `SELECT metadata_json, user_id, role_layer, team_parent_session_id
       FROM sessions
      WHERE id = ?
      LIMIT 1`,
    [sessionId],
  );
  if (!row) {
    return false;
  }

  if (typeof row.role_layer === 'string' && row.role_layer.trim().length > 0) {
    return true;
  }

  if (
    typeof row.team_parent_session_id === 'string' &&
    row.team_parent_session_id.trim().length > 0
  ) {
    return true;
  }

  const metadata = parseSessionMetadataJson(row.metadata_json);
  return (
    typeof metadata['teamWorkspaceId'] === 'string' && metadata['teamWorkspaceId'].trim().length > 0
  );
}

export function assertSessionWorkingDirectory(sessionId: string): string {
  const workingDirectory = getSessionWorkingDirectory(sessionId);
  if (!workingDirectory) {
    if (requiresBoundSessionWorkspace(sessionId)) {
      throw new Error('当前会话未绑定工作区，请先设置 workingDirectory。');
    }
    return WORKSPACE_ROOT;
  }
  return workingDirectory;
}

export type SessionWorkspacePathValidationResult =
  | {
      ok: true;
      safePath: string;
      workingDirectory: string | null;
    }
  | {
      ok: false;
      reason: 'forbidden-path' | 'outside-session-workspace';
      safePath: string | null;
      workingDirectory: string | null;
    };

export function validateSessionWorkspacePath(input: {
  path: string;
  sessionId: string;
}): SessionWorkspacePathValidationResult {
  const safePath = validateWorkspacePath(input.path);
  if (!safePath) {
    return {
      ok: false,
      reason: 'forbidden-path',
      safePath: null,
      workingDirectory: null,
    };
  }

  const workingDirectory = getSessionWorkingDirectory(input.sessionId);
  if (workingDirectory && !isPathWithinRoot(safePath, workingDirectory)) {
    return {
      ok: false,
      reason: 'outside-session-workspace',
      safePath,
      workingDirectory,
    };
  }

  return {
    ok: true,
    safePath,
    workingDirectory,
  };
}

export function assertSessionWorkspacePath(input: { path: string; sessionId: string }): string {
  assertWorkspacePathSupportedByCurrentHost(input.path);
  const workingDirectory = getSessionWorkingDirectory(input.sessionId);
  if (!workingDirectory && requiresBoundSessionWorkspace(input.sessionId)) {
    throw new Error(`当前会话未绑定工作区，禁止访问路径：${input.path}`);
  }
  const result = validateSessionWorkspacePath(input);
  if (!result.ok) {
    if (result.reason === 'forbidden-path') {
      throw new Error(`Forbidden workspace path: ${input.path}`);
    }
    throw new Error(`Target path is outside current session workspace: ${result.safePath}`);
  }
  return result.safePath;
}

export function resolveWorkspaceEntryPathForRequest(input: {
  path: string;
  sessionId?: string | null;
  userId?: string | null;
  workspaceRoot?: string | null;
}): string | null {
  if (input.sessionId) {
    const sessionWorkingDirectory = input.userId
      ? getSessionWorkingDirectoryForUser(input.sessionId, input.userId)
      : getSessionWorkingDirectory(input.sessionId);
    if (sessionWorkingDirectory) {
      return resolveWorkspaceEntryPath(input.path, sessionWorkingDirectory);
    }
  }

  const workspaceRoot = input.workspaceRoot ? validateWorkspacePath(input.workspaceRoot) : null;
  return resolveWorkspaceEntryPath(input.path, workspaceRoot);
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
