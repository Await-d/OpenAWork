import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const WORKSPACE_ROOT = path.join(tmpdir(), `openawork-trunc-ws-${process.pid}`);
const SECOND_WORKSPACE_ROOT = path.join(tmpdir(), `openawork-trunc-ws-2-${process.pid}`);
const DATA_DIR = path.join(tmpdir(), `openawork-trunc-data-${process.pid}`);
let workspaceAccessRestricted = false;

vi.mock('../../infra/db.js', () => ({
  WORKSPACE_ROOT,
  WORKSPACE_ROOTS: [WORKSPACE_ROOT, SECOND_WORKSPACE_ROOT],
  get WORKSPACE_ACCESS_MODE() {
    return workspaceAccessRestricted ? ('restricted' as const) : ('unrestricted' as const);
  },
  get WORKSPACE_ACCESS_RESTRICTED() {
    return workspaceAccessRestricted;
  },
  WORKSPACE_BROWSER_ROOT: '/',
}));

vi.mock('../../infra/storage-paths.js', () => ({
  resolveGatewayDataDir: () => DATA_DIR,
}));

const {
  listTruncationDirCandidates,
  resetTruncationDirCacheForTests,
  resolveWritableTruncationDir,
  truncateBashOutput,
  TRUNCATION_DIR,
} = await import('../../tools/bash-output-truncator.js');

describe('bash-output-truncator', () => {
  beforeEach(() => {
    workspaceAccessRestricted = false;
    resetTruncationDirCacheForTests();
    mkdirSync(WORKSPACE_ROOT, { recursive: true });
    mkdirSync(SECOND_WORKSPACE_ROOT, { recursive: true });
    mkdirSync(DATA_DIR, { recursive: true });
  });

  afterEach(() => {
    workspaceAccessRestricted = false;
    resetTruncationDirCacheForTests();
    rmSync(WORKSPACE_ROOT, { recursive: true, force: true });
    rmSync(SECOND_WORKSPACE_ROOT, { recursive: true, force: true });
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it('lists workspace tool-output first, then data dir, then os tmp', () => {
    const candidates = listTruncationDirCandidates();
    expect(candidates[0]).toBe(TRUNCATION_DIR);
    expect(candidates[0]).toBe(path.join(WORKSPACE_ROOT, '.openAwork', 'tool-output'));
    expect(candidates[1]).toBe(path.join(SECOND_WORKSPACE_ROOT, '.openAwork', 'tool-output'));
    expect(candidates).toContain(path.join(DATA_DIR, 'tool-output'));
    expect(candidates).toContain(path.join(tmpdir(), 'openAwork', 'tool-output'));
  });

  it('writes truncated full output under a writable truncation dir', async () => {
    const big = `${'line\n'.repeat(3000)}tail-marker`;
    const result = await truncateBashOutput(big, 'tail');
    expect(result.truncated).toBe(true);
    expect(result.outputPath).toBeTruthy();
    expect(result.content).toContain('Output truncated');
    expect(result.content).toContain('Full output saved to:');
    expect(listTruncationDirCandidates().some((dir) => result.outputPath?.startsWith(dir))).toBe(
      true,
    );
  });

  it('falls back when the preferred workspace tool-output dir is not writable', async () => {
    // Preferred parent path is a regular file → mkdir of tool-output fails.
    writeFileSync(path.join(WORKSPACE_ROOT, '.openAwork'), 'not-a-directory', 'utf-8');

    const dir = await resolveWritableTruncationDir();
    expect(dir).not.toBe(TRUNCATION_DIR);
    expect(dir).toBe(path.join(SECOND_WORKSPACE_ROOT, '.openAwork', 'tool-output'));

    const result = await truncateBashOutput(`${'x'.repeat(60_000)}`, 'tail');
    expect(result.truncated).toBe(true);
    expect(result.outputPath?.startsWith(dir)).toBe(true);
  });

  it('in restricted mode only falls back to another workspace root', async () => {
    workspaceAccessRestricted = true;
    resetTruncationDirCacheForTests();

    writeFileSync(path.join(WORKSPACE_ROOT, '.openAwork'), 'not-a-directory', 'utf-8');

    const candidates = listTruncationDirCandidates();
    expect(candidates).toEqual([
      path.join(WORKSPACE_ROOT, '.openAwork', 'tool-output'),
      path.join(SECOND_WORKSPACE_ROOT, '.openAwork', 'tool-output'),
    ]);

    const dir = await resolveWritableTruncationDir();
    expect(dir).toBe(path.join(SECOND_WORKSPACE_ROOT, '.openAwork', 'tool-output'));

    const result = await truncateBashOutput(`${'x'.repeat(60_000)}`, 'tail');
    expect(result.truncated).toBe(true);
    expect(result.outputPath?.startsWith(dir)).toBe(true);
    expect(result.outputPath?.startsWith(path.join(DATA_DIR, 'tool-output'))).toBe(false);
    expect(result.outputPath?.startsWith(path.join(tmpdir(), 'openAwork', 'tool-output'))).toBe(
      false,
    );
  });
});
