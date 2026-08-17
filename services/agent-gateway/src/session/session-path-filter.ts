/**
 * session-path-filter — pure helper that filters a list of session
 * rows by their resolved `workingDirectory`. Keeps the path-matching
 * logic separate from the `/sessions` route so it can be unit-tested
 * without standing up a full Fastify + SQLite harness.
 *
 * Mirrors opencode #24849: users routinely bounce between workspaces
 * on desktop and want the session list to scope down to "just this
 * directory" without losing their global history.
 *
 * Safety rule — `/a` must NOT match `/abc`. We normalise both the
 * filter path and the session `workingDirectory` by resolving them to
 * absolute paths and then comparing against a `<path><sep>` prefix
 * for the descendants case.
 */

import { posix, win32 } from 'node:path';

import {
  extractSessionWorkingDirectory,
  parseSessionMetadataJson,
} from './session-workspace-metadata.js';

/** Minimal row shape the filter needs. Parameterised so both the in-DB
 *  shape (`metadata_json`) and already-parsed callers can reuse it. */
export interface PathFilterableSession {
  id: string;
  metadata_json: string;
}

export interface SessionPathFilterInput {
  /** Filter path (absolute or relative — resolved before comparison). */
  path: string;
  /**
   * When true (default): match the path exactly OR any descendant.
   * When false: match only sessions whose workingDirectory equals the
   * filter path exactly.
   */
  includeDescendants?: boolean;
}

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^(?:[A-Za-z]:[\\/]|\\\\)/;

function filterPathFlavor(raw: string): typeof posix {
  if (WINDOWS_ABSOLUTE_PATH_PATTERN.test(raw) || raw.includes('\\')) {
    return win32;
  }
  return process.platform === 'win32' && !raw.startsWith('/') ? win32 : posix;
}

/**
 * Normalise a path for comparison. Resolves to an absolute path and
 * strips a trailing separator (except on the root `/`).
 */
export function normaliseFilterPath(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return '';
  const flavor = filterPathFlavor(trimmed);
  const resolved = flavor.resolve(trimmed);
  const root = flavor.parse(resolved).root;
  return resolved === root ? resolved : resolved.replace(/[\\/]+$/, '');
}

/**
 * Decide whether a single session row matches the filter. Exposed so
 * callers can reuse the match logic against rows they already parsed
 * into another shape (e.g. reconciled runtime rows).
 */
export function sessionMatchesPath(
  row: PathFilterableSession,
  filter: SessionPathFilterInput,
): boolean {
  const normalisedFilter = normaliseFilterPath(filter.path);
  if (!normalisedFilter) return false;

  const workingDirectory = extractSessionWorkingDirectory(
    parseSessionMetadataJson(row.metadata_json),
  );
  if (!workingDirectory) return false;

  const normalisedSession = normaliseFilterPath(workingDirectory);
  if (!normalisedSession) return false;
  const flavor = filterPathFlavor(normalisedFilter);
  if (flavor !== filterPathFlavor(normalisedSession)) return false;

  if (filter.includeDescendants === false) {
    return normalisedSession === normalisedFilter;
  }

  if (normalisedSession === normalisedFilter) return true;
  // Descendant match: prefix + separator so `/a` doesn't match `/abc`.
  return normalisedSession.startsWith(normalisedFilter + flavor.sep);
}

/**
 * Filter a list of session rows. Order and row identity are
 * preserved; the helper never rewrites the inputs.
 */
export function filterSessionsByPath<T extends PathFilterableSession>(
  rows: T[],
  filter: SessionPathFilterInput,
): T[] {
  const normalised = normaliseFilterPath(filter.path);
  if (!normalised) return rows;
  return rows.filter((row) => sessionMatchesPath(row, filter));
}
