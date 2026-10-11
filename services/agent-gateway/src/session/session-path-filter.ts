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
  extractSessionSshConnectionId,
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
  /**
   * Scope the filter to a single SSH connection.
   *
   * `path` alone is ambiguous for remote sessions: two hosts can each host
   * `/srv/app`, and both would match a filter for `/srv/app`. Callers that
   * know which workspace is selected pass the connection id so the filter
   * stays host-scoped. Omitted / `null` keeps the legacy path-only behaviour
   * (matches local sessions and remote sessions from any host).
   */
  sshConnectionId?: string | null;
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

  const metadata = parseSessionMetadataJson(row.metadata_json);

  // Host scoping runs before path matching: two SSH hosts can each hold an
  // identical `/srv/app`, so a path-only filter would otherwise sweep in
  // sessions from every host that happens to have that directory.
  const expectedConnectionId = filter.sshConnectionId?.trim();
  if (expectedConnectionId && extractSessionSshConnectionId(metadata) !== expectedConnectionId) {
    return false;
  }

  const workingDirectory = extractSessionWorkingDirectory(metadata);
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
