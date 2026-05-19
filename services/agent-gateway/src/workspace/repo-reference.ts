/**
 * repo-reference — pure parser + cache-path resolver for the P1-SCOUT
 * `repo_clone` / `repo_overview` tools.
 *
 * Ported from opencode's `packages/opencode/src/util/repository.ts`
 * (commit 40d5ea1cf, #24149) so the two implementations stay in sync
 * on URL grammar; the only OpenAWork-specific changes are:
 *
 *   - cache root resolves through `resolveGatewayReposDir()` instead
 *     of opencode's `Global.Path.repos`
 *   - the GitHub remote base URL env var is renamed to
 *     `OPENAWORK_REPO_CLONE_GITHUB_BASE_URL` so a single binary can
 *     coexist with an opencode install without env collisions
 *
 * Accepted reference shapes (all yield a host / owner? / repo /
 * `remote` git URL / `label`):
 *
 *   github:owner/repo
 *   owner/repo                              (assumed github.com)
 *   github.com/owner/repo
 *   gitlab.com/group/subgroup/repo
 *   git@github.com:owner/repo.git           (SCP-style)
 *   ssh://git@github.com/owner/repo.git
 *   https://github.com/owner/repo[.git]
 *   git+https://github.com/owner/repo.git   (npm-style git+ prefix)
 *   file:///abs/path/to/local-checkout
 *
 * Refused: bare strings without a recognisable repo path, host names
 * containing whitespace or starting with a leading dash (CLI-injection
 * guard), or path segments containing `..` / `:` / slashes.
 */

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveGatewayReposDir } from '../storage-paths.js';

export interface RepositoryReference {
  /** Lower-cased host, or the literal `'file'` for local checkouts. */
  host: string;
  /** Slash-joined path under the host, e.g. `owner/repo`. */
  path: string;
  /** Each path component, suitable for use in filesystem joins. */
  segments: string[];
  /** Owner segment when the path is exactly `<owner>/<repo>`. */
  owner?: string;
  /** Trailing path segment, with `.git` suffix stripped. */
  repo: string;
  /** Canonicalised git remote URL suitable for `git clone <remote>`. */
  remote: string;
  /** Display label — `owner/repo` for GitHub, `host/path` otherwise. */
  label: string;
  /** URL protocol (`https:`, `ssh:`, `git:`, `file:`, etc.) when known. */
  protocol?: string;
}

function normalize(input: string): string {
  return input
    .trim()
    .replace(/^git\+/, '')
    .replace(/#.*$/, '')
    .replace(/\/+$/, '');
}

function trimGitSuffix(input: string): string {
  return input.replace(/\.git$/, '');
}

function parts(input: string): string[] {
  return input
    .split('/')
    .map((item) => trimGitSuffix(item.trim()))
    .filter(Boolean);
}

function safeHost(input: string): boolean {
  return Boolean(input) && !input.startsWith('-') && !/[\s/\\]/.test(input);
}

function safeSegment(input: string): boolean {
  return input !== '.' && input !== '..' && !input.includes(':') && !/[\s/\\]/.test(input);
}

function hostLike(input: string): boolean {
  return input.includes('.') || input.includes(':') || input === 'localhost';
}

function withSlash(input: string): string {
  return input.endsWith('/') ? input : `${input}/`;
}

function githubRemote(pathname: string): string {
  const base = process.env['OPENAWORK_REPO_CLONE_GITHUB_BASE_URL'];
  if (!base) return `https://github.com/${pathname}.git`;
  return new URL(`${pathname}.git`, withSlash(base)).href;
}

interface BuildInput {
  host: string;
  segments: string[];
  remote?: string;
  protocol?: string;
}

function build(input: BuildInput): RepositoryReference | null {
  const segments = input.segments.map(trimGitSuffix).filter(Boolean);
  if (
    !safeHost(input.host) ||
    segments.length === 0 ||
    segments.some((segment) => !safeSegment(segment))
  ) {
    return null;
  }
  const pathname = segments.join('/');
  const lastSegment = segments[segments.length - 1];
  if (!lastSegment) return null;
  const host = input.host.toLowerCase();
  return {
    host,
    path: pathname,
    segments,
    ...(segments.length === 2 && segments[0] ? { owner: segments[0] } : {}),
    repo: lastSegment,
    remote:
      input.remote ??
      (host === 'github.com' ? githubRemote(pathname) : `https://${host}/${pathname}.git`),
    label: host === 'github.com' && segments.length === 2 ? pathname : `${host}/${pathname}`,
    ...(input.protocol ? { protocol: input.protocol } : {}),
  };
}

interface BuildFileInput {
  url: URL;
  remote: string;
}

function buildFile(input: BuildFileInput): RepositoryReference | null {
  let filePath: string;
  try {
    filePath = fileURLToPath(input.url);
  } catch {
    return null;
  }
  const segments = filePath.split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0) return null;
  const repoSegment = segments[segments.length - 1];
  if (!repoSegment) return null;
  return {
    host: 'file',
    path: filePath,
    segments: segments.map((segment) => segment.replace(/:$/, '')),
    repo: trimGitSuffix(repoSegment),
    remote: input.remote,
    label: filePath,
    protocol: 'file:',
  };
}

/**
 * Parse a user-supplied repository reference. Returns `null` for any
 * input that does not unambiguously identify a repo — callers should
 * surface a clear validation error in that case.
 */
export function parseRepositoryReference(input: string): RepositoryReference | null {
  if (typeof input !== 'string') return null;
  const cleaned = normalize(input);
  if (!cleaned) return null;

  const githubPrefixed = cleaned.match(/^github:([^/\s]+)\/([^/\s]+)$/);
  if (githubPrefixed?.[1] && githubPrefixed[2]) {
    return build({ host: 'github.com', segments: [githubPrefixed[1], githubPrefixed[2]] });
  }

  if (!cleaned.includes('://')) {
    const scp = cleaned.match(/^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/);
    if (scp?.[1] && scp[2]) {
      return build({ host: scp[1], segments: parts(scp[2]), remote: cleaned });
    }

    const direct = parts(cleaned);
    if (direct.length >= 2 && direct[0] && hostLike(direct[0])) {
      return build({ host: direct[0], segments: direct.slice(1) });
    }

    if (direct.length === 2) {
      return build({ host: 'github.com', segments: direct });
    }

    return null;
  }

  let url: URL;
  try {
    url = new URL(cleaned);
  } catch {
    return null;
  }
  if (url.protocol === 'file:') return buildFile({ url, remote: cleaned });
  const pathname = parts(url.pathname);
  const host = url.host;
  return build({
    host,
    segments: pathname,
    remote: host === 'github.com' ? githubRemote(pathname.join('/')) : cleaned,
    protocol: url.protocol,
  });
}

/**
 * Lighter form of {@link parseRepositoryReference} that only accepts
 * GitHub remotes. Returns `null` for non-GitHub inputs or anything
 * other than `<owner>/<repo>` shape. Useful when a caller really does
 * want a (owner, repo) pair instead of the full reference.
 */
export function parseGitHubRemote(input: string): { owner: string; repo: string } | null {
  if (typeof input !== 'string') return null;
  const cleaned = normalize(input);
  if (!cleaned.includes('://') && !/^(?:[^@/\s]+@)?github\.com:/.test(cleaned)) {
    return null;
  }
  const parsed = parseRepositoryReference(cleaned);
  if (!parsed || parsed.host !== 'github.com' || !parsed.owner || parsed.segments.length !== 2) {
    return null;
  }
  return { owner: parsed.owner, repo: parsed.repo };
}

/**
 * Resolve the local cache directory for a parsed reference. Mirrors
 * `<host>/<owner>/<repo>` — host-with-port is split on `:` so a
 * `gitlab.example:8080` host becomes `gitlab.example/8080/...`.
 */
export function repositoryCachePath(input: RepositoryReference): string {
  return join(resolveGatewayReposDir(), ...input.host.split(':'), ...input.segments);
}

/**
 * Strict reference equality used by `repo_clone` to decide whether a
 * cached checkout matches the request. Two references are "the same"
 * when their host AND path match exactly.
 */
export function sameRepositoryReference(
  left: RepositoryReference,
  right: RepositoryReference,
): boolean {
  return left.host === right.host && left.path === right.path;
}
