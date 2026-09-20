/**
 * Resolve a possibly-bare filename (e.g. `create_quotation.py`) to a
 * full workspace-relative path by querying `/workspace/find-by-name`.
 *
 * Why this lives here: both `useFileEditor.openFile` (click → open in
 * editor) and `useFilePreview` (hover → snippet popover) need the
 * same resolution rule, otherwise hovering produces 403 / shows the
 * wrong file even when clicking eventually succeeds. Centralising
 * also lets one resolver cache feed both flows.
 *
 * Workspace isolation:
 *   - We always pass the active `workspaceRoot` to the gateway. The
 *     server-side `validateWorkspacePath` gate then refuses scans
 *     outside that root.
 *   - As a defence-in-depth, we also reject any returned hit whose
 *     path doesn't actually start with `workspaceRoot/` on the
 *     client. A misconfigured / hostile server can't trick us into
 *     opening a file from another workspace.
 *   - The resolver cache key includes `workspaceRoot` so cross-
 *     workspace switching never reuses a stale resolution.
 *
 * Resolution rules:
 *   1. Path already looks complete (`/abs/...` or contains `/`) →
 *      return as-is. Saves one round-trip on the common case.
 *   1.5 SSH identity present (`sessionId` / `sshConnectionId`) → resolve
 *      the bare name against the SSH-aware file index
 *      (`searchFileIndexResult`) instead of `findByName`, and return the
 *      shortest relative path whose basename matches exactly. A nested
 *      file (e.g. `<remoteRoot>/src/create_quotation.py`) thus resolves
 *      correctly instead of the raw name mapping to
 *      `<remoteRoot>/create_quotation.py`. Empty / failed search falls
 *      back to the raw name and never throws.
 *   2. No workspace root configured → return as-is so `readFile`
 *      surfaces a readable error.
 *   3. `findByName` (basename match, NOT content grep) within the
 *      active workspace root. Prefer the shortest path among hits
 *      so root-level files win over nested duplicates.
 *   4. No exact basename match → return the original; let `readFile`
 *      surface the 404 with the same token the user clicked.
 */

import type { WorkspaceClient } from '@openAwork/web-client';
import type { WorkspaceReadIdentity } from '../../../stores/ui/uiState.js';

const resolutionCache = new Map<string, { resolved: string; ts: number }>();
const inflight = new Map<string, Promise<string>>();
const RESOLUTION_TTL_MS = 60_000;

function cacheKey(workspaceRoot: string, bareName: string, identityKey: string): string {
  // 身份命名空间必须入键：本地与远端可能给出同形路径（如 /home/x/a.ts）。
  return `${identityKey}::${workspaceRoot}::${bareName}`;
}

function normalizeRoot(root: string): string {
  // Drop trailing slashes so the prefix check below is consistent.
  return root.replace(/\/+$/u, '');
}

function isWithinWorkspace(candidate: string, workspaceRoot: string): boolean {
  if (workspaceRoot.length === 0) return false;
  const normalized = normalizeRoot(workspaceRoot);
  // Allow an exact match of the root itself or any descendant.
  return candidate === normalized || candidate.startsWith(`${normalized}/`);
}

const REMOTE_BARE_NAME_SEARCH_LIMIT = 20;

/**
 * 从远端索引返回的相对路径中挑出 basename 恰好等于 `bareName` 的最短路径：
 * 段数最少者优先，段数相同按字典序，确保同一输入得到确定结果。
 */
function pickShortestBareNameMatch(files: readonly string[], bareName: string): string | null {
  const matches = files.filter((file) => file.split('/').pop() === bareName);
  if (matches.length === 0) return null;
  const sorted = [...matches].sort((left, right) => {
    const segmentDelta = left.split('/').length - right.split('/').length;
    return segmentDelta !== 0 ? segmentDelta : left.localeCompare(right);
  });
  return sorted[0] ?? null;
}

/**
 * SSH 身份下用远端文件索引解析裸文件名。失败 / 无命中返回 null，由调用方回退
 * 裸名（绝不抛错）。
 */
async function searchRemoteBareFilename(input: {
  client: WorkspaceClient;
  token: string;
  root: string;
  bareName: string;
  identity: WorkspaceReadIdentity;
  signal?: AbortSignal;
}): Promise<string | null> {
  const { client, token, root, bareName, identity, signal } = input;
  try {
    const result = await client.searchFileIndexResult(token, root, {
      query: bareName,
      limit: REMOTE_BARE_NAME_SEARCH_LIMIT,
      ...(signal ? { signal } : {}),
      ...(identity.sessionId ? { sessionId: identity.sessionId } : {}),
      ...(!identity.sessionId && identity.sshConnectionId
        ? { sshConnectionId: identity.sshConnectionId }
        : {}),
    });
    if (!result.ok) return null;
    return pickShortestBareNameMatch(result.files, bareName);
  } catch {
    return null;
  }
}

export interface ResolveBareFilenameInput {
  client: WorkspaceClient;
  token: string;
  workspaceRoot: string | null;
  rawPath: string;
  signal?: AbortSignal;
  identity?: WorkspaceReadIdentity | null;
}

export async function resolveBareFilename(input: ResolveBareFilenameInput): Promise<string> {
  const { client, token, workspaceRoot, rawPath, signal, identity } = input;

  const isCompletePath = rawPath.startsWith('/') || rawPath.includes('/');
  if (isCompletePath) return rawPath;
  if (!workspaceRoot || workspaceRoot.trim().length === 0) return rawPath;
  if (rawPath.length === 0) return rawPath;

  const root = normalizeRoot(workspaceRoot);
  const isRemoteIdentity = Boolean(identity?.sessionId || identity?.sshConnectionId);
  const identityKey = identity?.sessionId ?? identity?.sshConnectionId ?? 'local';
  const key = cacheKey(root, rawPath, identityKey);
  const cached = resolutionCache.get(key);
  if (cached && Date.now() - cached.ts < RESOLUTION_TTL_MS) {
    return cached.resolved;
  }
  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    try {
      let picked: string;
      if (isRemoteIdentity && identity) {
        const remoteHit = await searchRemoteBareFilename({
          client,
          token,
          root,
          bareName: rawPath,
          identity,
          ...(signal ? { signal } : {}),
        });
        // 搜索失败 / 无命中不缓存：远端索引可能仍在构建，交给下一次重试；
        // 回退裸名让 readFile 用用户点击的原始 token 报 404。
        if (remoteHit === null) return rawPath;
        picked = remoteHit;
      } else {
        const initOptions: { maxResults?: number; signal?: AbortSignal } = {
          maxResults: 16,
        };
        if (signal) initOptions.signal = signal;
        const hits = await client.findByName(token, rawPath, root, initOptions);
        // Defence-in-depth: drop any hit not inside the requested root.
        // Server-side validateWorkspacePath should already prevent this,
        // but we don't trust it to ensure cross-workspace isolation
        // matters here.
        const safeHits = hits.filter((h) => isWithinWorkspace(h.path, root));
        // Prefer the shortest matching path (closer to the root, less
        // likely to be a vendored / nested duplicate of the same name).
        picked =
          safeHits.length > 0
            ? (safeHits.sort((a, b) => a.path.length - b.path.length)[0]?.path ?? rawPath)
            : rawPath;
      }
      resolutionCache.set(key, { resolved: picked, ts: Date.now() });
      return picked;
    } catch {
      // Don't cache failures so the next attempt retries; just
      // surface the bare path to the caller.
      return rawPath;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  return promise;
}

/** Test/devtools hook — clears the resolver cache. */
export function __clearBareFilenameResolutionCacheForTest(): void {
  resolutionCache.clear();
  inflight.clear();
}
