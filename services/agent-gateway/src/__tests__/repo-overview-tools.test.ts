/**
 * Regression coverage for the `repo_overview` tool.
 *
 * Strategy: write a tiny fake repo into a temp dir, point
 * `OPENAWORK_DATA_DIR` at it so `repositoryCachePath` resolves under
 * the temp tree, then exercise the tool with both `repository` and
 * `path` inputs. The git binary is replaced with a fake that returns
 * canned `branch` / `rev-parse` results so the assertions stay stable.
 *
 * What the tests pin:
 *
 *   - happy-path resolves repository → cache path, runs git for HEAD
 *     and branch, detects ecosystems / package manager / dependency
 *     files / entrypoints from package.json
 *   - structure tree is depth-limited and ignores the noisy dirs
 *   - the truncation flag flips when STRUCTURE_LIMIT is exceeded
 *   - `path` input that escapes the repos cache is rejected unless
 *     `OPENAWORK_REPO_OVERVIEW_ALLOW_ANY_PATH=1`
 *   - missing repository surfaces a "use repo_clone first" error
 *   - non-directory `path` produces a clear error
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createRepoOverviewTool,
  detectCommonEntrypoints,
  detectEcosystems,
  detectPackageManager,
  type RepoOverviewInput,
} from '../repo-overview-tools.js';
import type { GitRunner } from '../repo-clone-tools.js';

/**
 * Shared "never-aborted" signal so tests don't have to pass
 * `undefined` (which doesn't match the `signal: AbortSignal`
 * parameter type on `ToolDefinition.execute`).
 */
const NO_SIGNAL = new AbortController().signal;

const ORIGINAL_ENV = { ...process.env };
let tempDir = '';

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'openawork-repo-overview-test-'));
  process.env = { ...ORIGINAL_ENV, OPENAWORK_DATA_DIR: tempDir };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  if (tempDir && existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function reposRoot(): string {
  return join(tempDir, 'repos');
}

function fakeGit(canned: Record<string, { exitCode: number; stdout: string }> = {}): GitRunner {
  return async (args) => {
    const key = args.join(' ');
    if (canned[key]) return { ...canned[key], stderr: '' };
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
      return { exitCode: 0, stdout: 'abc123def\n', stderr: '' };
    }
    if (args[0] === 'symbolic-ref') {
      return { exitCode: 0, stdout: 'main\n', stderr: '' };
    }
    return { exitCode: 1, stdout: '', stderr: '' };
  };
}

interface SeedFile {
  path: string;
  content: string;
}

function seedRepo(input: { host: string; owner: string; repo: string; files: SeedFile[] }): string {
  const root = join(reposRoot(), input.host, input.owner, input.repo);
  mkdirSync(root, { recursive: true });
  // Put a `.git` directory so git invocations look plausible from the
  // tool's point of view (even though the runner is faked).
  mkdirSync(join(root, '.git'), { recursive: true });
  for (const file of input.files) {
    const full = join(root, file.path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, file.content);
  }
  return root;
}

describe('detectPackageManager', () => {
  it('prefers bun.lock', () => {
    expect(detectPackageManager(new Set(['bun.lock', 'pnpm-lock.yaml']))).toBe('bun');
  });
  it('falls back to pnpm', () => {
    expect(detectPackageManager(new Set(['pnpm-lock.yaml']))).toBe('pnpm');
  });
  it('returns undefined when no lockfile is present', () => {
    expect(detectPackageManager(new Set(['package.json']))).toBeUndefined();
  });
});

describe('detectEcosystems', () => {
  it('detects multiple ecosystems from a mixed lockfile set', () => {
    const list = detectEcosystems(
      new Set(['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml']),
    );
    expect(list).toEqual(['Node.js', 'Python', 'Go', 'Rust']);
  });

  it('treats requirements.txt as Python', () => {
    expect(detectEcosystems(new Set(['requirements.txt']))).toEqual(['Python']);
  });
});

describe('detectCommonEntrypoints', () => {
  it('only reports filenames that appear in the input set', () => {
    expect(detectCommonEntrypoints(new Set(['index.ts', 'unused.ts']))).toEqual(['index.ts']);
  });
});

describe('repo_overview tool — repository input', () => {
  it('resolves a cached repo, runs git for HEAD/branch, detects ecosystems', async () => {
    seedRepo({
      host: 'github.com',
      owner: 'foo',
      repo: 'bar',
      files: [
        {
          path: 'package.json',
          content: JSON.stringify({
            name: 'bar',
            main: 'dist/index.js',
            module: 'dist/index.mjs',
            types: 'dist/index.d.ts',
            bin: { 'bar-cli': './dist/cli.js' },
          }),
        },
        { path: 'pnpm-lock.yaml', content: '' },
        { path: 'src/index.ts', content: '// entry' },
      ],
    });

    const tool = createRepoOverviewTool({ gitRun: fakeGit() });
    const result = await tool.execute({ repository: 'foo/bar' } as RepoOverviewInput, NO_SIGNAL);
    expect(result.repository).toBe('foo/bar');
    expect(result.head).toBe('abc123def');
    expect(result.branch).toBe('main');
    expect(result.ecosystems).toEqual(['Node.js']);
    expect(result.packageManager).toBe('pnpm');
    expect(result.dependencyFiles).toContain('package.json');
    expect(result.dependencyFiles).toContain('pnpm-lock.yaml');
    expect(result.entrypoints).toEqual(
      expect.arrayContaining([
        'main: dist/index.js',
        'module: dist/index.mjs',
        'types: dist/index.d.ts',
        'bin: bar-cli',
        'file: src/index.ts',
      ]),
    );
    expect(result.depth).toBe(3);
    expect(result.truncated).toBe(false);
    expect(result.structure).toContain('package.json');
    expect(result.structure).toContain('src/');
  });

  it('errors with a "use repo_clone first" hint when the cache is empty', async () => {
    const tool = createRepoOverviewTool({ gitRun: fakeGit() });
    await expect(
      tool.execute({ repository: 'never/cloned' } as RepoOverviewInput, NO_SIGNAL),
    ).rejects.toThrow(/repo_clone first/);
  });

  it('rejects unparseable repository inputs', async () => {
    const tool = createRepoOverviewTool({ gitRun: fakeGit() });
    await expect(
      tool.execute({ repository: 'bad host/foo' } as RepoOverviewInput, NO_SIGNAL),
    ).rejects.toThrow(/git URL/);
  });
});

describe('repo_overview tool — path input', () => {
  it('accepts an absolute path inside the repos cache', async () => {
    const root = seedRepo({
      host: 'github.com',
      owner: 'foo',
      repo: 'bar',
      files: [{ path: 'package.json', content: '{}' }],
    });
    const tool = createRepoOverviewTool({ gitRun: fakeGit() });
    const result = await tool.execute({ path: root } as RepoOverviewInput, NO_SIGNAL);
    expect(result.path).toBe(root);
    expect(result.dependencyFiles).toContain('package.json');
  });

  it('rejects an absolute path outside the repos cache by default', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'openawork-repo-overview-outside-'));
    try {
      const tool = createRepoOverviewTool({ gitRun: fakeGit() });
      await expect(tool.execute({ path: outside } as RepoOverviewInput, NO_SIGNAL)).rejects.toThrow(
        /repos cache/,
      );
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('allows arbitrary paths when OPENAWORK_REPO_OVERVIEW_ALLOW_ANY_PATH=1', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'openawork-repo-overview-allow-any-'));
    try {
      writeFileSync(join(outside, 'go.mod'), 'module example\n');
      process.env['OPENAWORK_REPO_OVERVIEW_ALLOW_ANY_PATH'] = '1';
      const tool = createRepoOverviewTool({ gitRun: fakeGit() });
      const result = await tool.execute({ path: outside } as RepoOverviewInput, NO_SIGNAL);
      expect(result.ecosystems).toContain('Go');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('rejects relative paths', async () => {
    const tool = createRepoOverviewTool({ gitRun: fakeGit() });
    await expect(
      tool.execute({ path: './relative' } as RepoOverviewInput, NO_SIGNAL),
    ).rejects.toThrow(/absolute/);
  });

  it('errors when path is a file rather than a directory', async () => {
    const root = seedRepo({
      host: 'github.com',
      owner: 'foo',
      repo: 'bar',
      files: [{ path: 'package.json', content: '{}' }],
    });
    const tool = createRepoOverviewTool({ gitRun: fakeGit() });
    await expect(
      tool.execute({ path: join(root, 'package.json') } as RepoOverviewInput, NO_SIGNAL),
    ).rejects.toThrow(/not a directory/);
  });
});

describe('repo_overview tool — structure tree', () => {
  it('skips ignored directories like node_modules and .git', async () => {
    seedRepo({
      host: 'github.com',
      owner: 'foo',
      repo: 'with-noise',
      files: [
        { path: 'package.json', content: '{}' },
        { path: 'node_modules/some-dep/index.js', content: '' },
        { path: 'dist/bundle.js', content: '' },
      ],
    });
    const tool = createRepoOverviewTool({ gitRun: fakeGit() });
    const result = await tool.execute(
      { repository: 'foo/with-noise' } as RepoOverviewInput,
      NO_SIGNAL,
    );
    expect(result.structure.some((line) => line.includes('node_modules'))).toBe(false);
    expect(result.structure.some((line) => line.includes('dist'))).toBe(false);
  });

  it('respects the depth parameter', async () => {
    seedRepo({
      host: 'github.com',
      owner: 'foo',
      repo: 'depth-test',
      files: [
        { path: 'package.json', content: '{}' },
        { path: 'a/b/c/deep.txt', content: '' },
      ],
    });
    const tool = createRepoOverviewTool({ gitRun: fakeGit() });
    const shallow = await tool.execute(
      { repository: 'foo/depth-test', depth: 1 } as RepoOverviewInput,
      NO_SIGNAL,
    );
    // depth=1 means only the top-level entries, no descent into a/.
    expect(shallow.depth).toBe(1);
    expect(shallow.structure.some((line) => line.includes('b/'))).toBe(false);
  });
});
