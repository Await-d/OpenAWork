/**
 * External Directory Guard
 *
 * Ported from opencode's external-directory.ts.
 * Checks if a file path is outside the configured workspace roots and
 * logs/flags when external access occurs. In OpenAWork's architecture,
 * external paths are either blocked (when restricted) or allowed with a warning.
 */

import path from 'node:path';
import { WORKSPACE_ROOT_PATHS, isPathWithinRoot } from './workspace-paths.js';

/**
 * Check whether a path is external to all workspace roots.
 */
export function isExternalPath(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  return !WORKSPACE_ROOT_PATHS.some((root) => isPathWithinRoot(resolved, root));
}

/**
 * Get the parent directory for an external path (used in permission scoping).
 */
export function externalDirectoryScope(filePath: string): string {
  const resolved = path.resolve(filePath);
  const dir = path.dirname(resolved);
  return `external_directory:${dir}/*`;
}

/** Tracks which external directories have been accessed in this session. */
const sessionExternalDirs = new Map<string, Set<string>>();

/**
 * Record an external directory access for a session.
 * Returns true if this is the first time this directory was accessed in the session.
 */
export function recordExternalAccess(sessionId: string, filePath: string): boolean {
  const dir = path.dirname(path.resolve(filePath));
  let dirs = sessionExternalDirs.get(sessionId);
  if (!dirs) {
    dirs = new Set();
    sessionExternalDirs.set(sessionId, dirs);
  }
  if (dirs.has(dir)) return false;
  dirs.add(dir);
  return true;
}

/**
 * Clear external directory tracking for a session.
 */
export function clearExternalAccessTracking(sessionId: string): void {
  sessionExternalDirs.delete(sessionId);
}
