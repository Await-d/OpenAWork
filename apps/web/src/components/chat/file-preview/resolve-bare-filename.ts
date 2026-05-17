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
 *   2. No workspace root configured → return as-is so `readFile`
 *      surfaces a readable error.
 *   3. `findByName` (basename match, NOT content grep) within the
 *      active workspace root. Prefer the shortest path among hits
 *      so root-level files win over nested duplicates.
 *   4. No exact basename match → return the original; let `readFile`
 *      surface the 404 with the same token the user clicked.
 */

import type { WorkspaceClient } from '@openAwork/web-client';

const resolutionCache = new Map<string, { resolved: string; ts: number }>();
const inflight = new Map<string, Promise<string>>();
const RESOLUTION_TTL_MS = 60_000;

function cacheKey(workspaceRoot: string, bareName: string): string {
  return `${workspaceRoot}::${bareName}`;
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

export interface ResolveBareFilenameInput {
  client: WorkspaceClient;
  token: string;
  workspaceRoot: string | null;
  rawPath: string;
  signal?: AbortSignal;
}

export async function resolveBareFilename(input: ResolveBareFilenameInput): Promise<string> {
  const { client, token, workspaceRoot, rawPath, signal } = input;

  const isCompletePath = rawPath.startsWith('/') || rawPath.includes('/');
  if (isCompletePath) return rawPath;
  if (!workspaceRoot || workspaceRoot.trim().length === 0) return rawPath;
  if (rawPath.length === 0) return rawPath;

  const root = normalizeRoot(workspaceRoot);
  const key = cacheKey(root, rawPath);
  const cached = resolutionCache.get(key);
  if (cached && Date.now() - cached.ts < RESOLUTION_TTL_MS) {
    return cached.resolved;
  }
  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    try {
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
      const picked =
        safeHits.length > 0
          ? (safeHits.sort((a, b) => a.path.length - b.path.length)[0]?.path ?? rawPath)
          : rawPath;
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
