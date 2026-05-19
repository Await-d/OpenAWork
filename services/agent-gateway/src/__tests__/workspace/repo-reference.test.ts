/**
 * Regression coverage for `repo-reference.ts`.
 *
 * Mirrors opencode #24149's `parseRepositoryReference` test surface so
 * the two implementations stay in sync on URL grammar. The cases below
 * pin both the happy path (owner/repo, GitHub URLs, SCP, file://) and
 * the safety-critical refusal paths (whitespace, `..`, leading dash).
 *
 * `repositoryCachePath` is exercised against an explicit
 * `OPENAWORK_DATA_DIR` so the test does not depend on the host's home
 * directory or platform adapter. Cache layout invariant:
 * `<dataDir>/repos/<host>/<owner>/<repo>`.
 */

import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  parseGitHubRemote,
  parseRepositoryReference,
  repositoryCachePath,
  sameRepositoryReference,
} from '../../workspace/repo-reference.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('parseRepositoryReference — GitHub shapes', () => {
  it('accepts owner/repo and infers github.com', () => {
    const ref = parseRepositoryReference('octocat/Hello-World');
    expect(ref).not.toBeNull();
    expect(ref?.host).toBe('github.com');
    expect(ref?.owner).toBe('octocat');
    expect(ref?.repo).toBe('Hello-World');
    expect(ref?.path).toBe('octocat/Hello-World');
    expect(ref?.remote).toBe('https://github.com/octocat/Hello-World.git');
    expect(ref?.label).toBe('octocat/Hello-World');
  });

  it('accepts the github:owner/repo prefix shorthand', () => {
    const ref = parseRepositoryReference('github:vercel/next.js');
    expect(ref?.host).toBe('github.com');
    expect(ref?.repo).toBe('next.js');
    expect(ref?.remote).toBe('https://github.com/vercel/next.js.git');
  });

  it('strips the .git suffix on the trailing segment', () => {
    const ref = parseRepositoryReference('https://github.com/foo/bar.git');
    expect(ref?.repo).toBe('bar');
    expect(ref?.path).toBe('foo/bar');
  });

  it('strips the npm-style git+ prefix and # fragment', () => {
    const ref = parseRepositoryReference('git+https://github.com/foo/bar.git#main');
    expect(ref?.host).toBe('github.com');
    expect(ref?.path).toBe('foo/bar');
    expect(ref?.remote).toBe('https://github.com/foo/bar.git');
  });

  it('parses SCP-style git@github.com:owner/repo and preserves the original remote', () => {
    const ref = parseRepositoryReference('git@github.com:foo/bar.git');
    expect(ref?.host).toBe('github.com');
    expect(ref?.owner).toBe('foo');
    expect(ref?.repo).toBe('bar');
    expect(ref?.remote).toBe('git@github.com:foo/bar.git');
  });

  it('lower-cases the host', () => {
    const ref = parseRepositoryReference('https://GitHub.com/foo/bar');
    expect(ref?.host).toBe('github.com');
  });
});

describe('parseRepositoryReference — non-GitHub hosts', () => {
  it('parses gitlab path-style with a sub-group', () => {
    const ref = parseRepositoryReference('gitlab.com/group/subgroup/repo');
    expect(ref?.host).toBe('gitlab.com');
    expect(ref?.path).toBe('group/subgroup/repo');
    expect(ref?.repo).toBe('repo');
    // Non-GitHub fallback remote.
    expect(ref?.remote).toBe('https://gitlab.com/group/subgroup/repo.git');
    // owner is only set when path is exactly 2 segments.
    expect(ref?.owner).toBeUndefined();
    // Label is host/path for non-GitHub.
    expect(ref?.label).toBe('gitlab.com/group/subgroup/repo');
  });

  it('parses ssh:// URLs', () => {
    const ref = parseRepositoryReference('ssh://git@gitlab.com/foo/bar.git');
    expect(ref?.host).toBe('gitlab.com');
    expect(ref?.protocol).toBe('ssh:');
    expect(ref?.path).toBe('foo/bar');
  });

  it('parses file:// URLs and exposes the absolute path as label', () => {
    const ref = parseRepositoryReference('file:///tmp/local-checkout');
    expect(ref?.host).toBe('file');
    expect(ref?.protocol).toBe('file:');
    expect(ref?.repo).toBe('local-checkout');
    expect(ref?.label).toContain('/tmp/local-checkout');
  });
});

describe('parseRepositoryReference — refusals', () => {
  it('rejects empty / whitespace input', () => {
    expect(parseRepositoryReference('')).toBeNull();
    expect(parseRepositoryReference('   ')).toBeNull();
  });

  it('rejects single-segment shorthand (would be ambiguous)', () => {
    expect(parseRepositoryReference('octocat')).toBeNull();
  });

  it('rejects path traversal segments', () => {
    expect(parseRepositoryReference('foo/..')).toBeNull();
    expect(parseRepositoryReference('https://github.com/foo/..')).toBeNull();
  });

  it('rejects hosts containing whitespace', () => {
    expect(parseRepositoryReference('bad host/foo/bar')).toBeNull();
  });

  it('rejects hosts with a leading dash (CLI injection guard)', () => {
    expect(parseRepositoryReference('-evilhost/foo/bar')).toBeNull();
  });

  it('rejects malformed URLs', () => {
    expect(parseRepositoryReference('https://')).toBeNull();
  });
});

describe('repositoryCachePath', () => {
  it('lays out cache as <dataDir>/repos/<host>/<owner>/<repo>', () => {
    process.env['OPENAWORK_DATA_DIR'] = '/tmp/openawork-test-data';
    const ref = parseRepositoryReference('octocat/Hello-World');
    expect(ref).not.toBeNull();
    if (!ref) return;
    expect(repositoryCachePath(ref)).toBe(
      join('/tmp/openawork-test-data', 'repos', 'github.com', 'octocat', 'Hello-World'),
    );
  });

  it('splits host:port so it does not corrupt the path', () => {
    process.env['OPENAWORK_DATA_DIR'] = '/tmp/openawork-test-data';
    const ref = parseRepositoryReference('https://gitlab.example:8443/foo/bar');
    expect(ref).not.toBeNull();
    if (!ref) return;
    expect(repositoryCachePath(ref)).toBe(
      join('/tmp/openawork-test-data', 'repos', 'gitlab.example', '8443', 'foo', 'bar'),
    );
  });
});

describe('sameRepositoryReference', () => {
  it('is true for two references with identical host and path', () => {
    const a = parseRepositoryReference('foo/bar');
    const b = parseRepositoryReference('https://github.com/foo/bar.git');
    expect(a && b && sameRepositoryReference(a, b)).toBe(true);
  });

  it('is false when the path differs', () => {
    const a = parseRepositoryReference('foo/bar');
    const b = parseRepositoryReference('foo/baz');
    expect(a && b && sameRepositoryReference(a, b)).toBe(false);
  });

  it('is false when the host differs', () => {
    const a = parseRepositoryReference('foo/bar');
    const b = parseRepositoryReference('gitlab.com/foo/bar');
    expect(a && b && sameRepositoryReference(a, b)).toBe(false);
  });
});

describe('parseGitHubRemote', () => {
  it('extracts owner+repo from a github URL', () => {
    expect(parseGitHubRemote('https://github.com/foo/bar.git')).toEqual({
      owner: 'foo',
      repo: 'bar',
    });
  });

  it('extracts owner+repo from SCP form', () => {
    expect(parseGitHubRemote('git@github.com:foo/bar.git')).toEqual({
      owner: 'foo',
      repo: 'bar',
    });
  });

  it('returns null for plain owner/repo (no protocol AND no SCP host marker)', () => {
    // The shorthand `foo/bar` is ambiguous in this stricter parser —
    // callers wanting "did the user type a github remote?" semantics
    // should reach for `parseRepositoryReference` instead.
    expect(parseGitHubRemote('foo/bar')).toBeNull();
  });

  it('returns null for non-GitHub hosts', () => {
    expect(parseGitHubRemote('https://gitlab.com/foo/bar')).toBeNull();
  });
});

describe('OPENAWORK_REPO_CLONE_GITHUB_BASE_URL override', () => {
  it('redirects the GitHub remote when the env var is set', () => {
    process.env['OPENAWORK_REPO_CLONE_GITHUB_BASE_URL'] = 'https://ghproxy.internal/';
    const ref = parseRepositoryReference('foo/bar');
    expect(ref?.remote).toBe('https://ghproxy.internal/foo/bar.git');
  });

  it('falls back to the public GitHub remote when the env var is unset', () => {
    delete process.env['OPENAWORK_REPO_CLONE_GITHUB_BASE_URL'];
    const ref = parseRepositoryReference('foo/bar');
    expect(ref?.remote).toBe('https://github.com/foo/bar.git');
  });
});
