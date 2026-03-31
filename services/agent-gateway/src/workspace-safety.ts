import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GrantedPermission } from '@openAwork/agent-core';
import { defaultIgnoreManager } from '@openAwork/agent-core';
import { WORKSPACE_ROOT, WORKSPACE_ROOTS, sqliteGet } from './db.js';
import {
  extractSessionWorkingDirectory,
  parseSessionMetadataJson,
} from './session-workspace-metadata.js';

const WORKSPACE_PERMISSION_FILE = '.openawork.permissions.json';

interface SessionMetadataRow {
  metadata_json: string;
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

function loadWorkspacePermissionFile(workspaceRoot: string): {
  permanentGrants?: GrantedPermission[];
} {
  const filePath = join(workspaceRoot, WORKSPACE_PERMISSION_FILE);
  if (!existsSync(filePath)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as { permanentGrants?: GrantedPermission[] };
  } catch {
    return {};
  }
}

function writeWorkspacePermissionFile(
  workspaceRoot: string,
  value: { permanentGrants?: GrantedPermission[] },
): void {
  writeFileSync(
    join(workspaceRoot, WORKSPACE_PERMISSION_FILE),
    JSON.stringify(value, null, 2),
    'utf8',
  );
}

function getSessionWorkspaceRoot(sessionId: string): string | null {
  const row = sqliteGet<SessionMetadataRow>(
    'SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1',
    [sessionId],
  );
  if (!row) {
    return null;
  }
  const metadata = parseSessionMetadataJson(row.metadata_json);
  return resolveWorkspaceRootForPath(extractSessionWorkingDirectory(metadata));
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
  const grants = loadWorkspacePermissionFile(workspaceRoot).permanentGrants ?? [];
  return grants.some(
    (grant) =>
      grant.toolName === toolName && grant.scope === scope && grant.decision === 'permanent',
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
  const current = loadWorkspacePermissionFile(workspaceRoot);
  const permanentGrants = current.permanentGrants ?? [];
  if (
    permanentGrants.some(
      (grant) => grant.toolName === input.toolName && grant.scope === input.scope,
    )
  ) {
    return;
  }
  permanentGrants.push({
    id: `${input.toolName}:${input.scope}:${Date.now()}`,
    toolName: input.toolName,
    scope: input.scope,
    grantedAt: Date.now(),
    decision: 'permanent',
  });
  writeWorkspacePermissionFile(workspaceRoot, { permanentGrants });
}
