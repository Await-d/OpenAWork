import { mkdtemp, rm, mkdir, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Regression (§0.106, loop finalization cleanup): clearPersistedLoopState runs
 * mid-finalization, right before the session metadata is rewritten to clear the
 * active-loop marker. It deletes the per-session state file then the legacy
 * state files via unlinkSync. An unguarded unlink throw (EACCES / EBUSY / EPERM
 * / EISDIR on a stale state path) used to abort the rest of finalization —
 * leaving the session stuck showing a running loop AND skipping cleanup of the
 * remaining (deletable) state files. The unlink is now best-effort per file.
 *
 * We make the per-session state path a DIRECTORY so unlinkSync throws, then
 * assert clearPersistedLoopState (a) does not throw and (b) still deletes the
 * legacy state file — proving the loop continued past the throwing entry.
 */
let workspaceRoot: string;
const SESSION_ID = 'sess-cleanup-resilience';
const STATE_FILE_PREFIX = '.openawork.ralph-loop';
const STATE_FILE_SUFFIX = '.local.md';
const LEGACY_OPENAWORK_STATE_FILE = '.openawork.ralph-loop.local.md';

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'loop-cleanup-'));
});

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
});

describe('clearPersistedLoopState unlink resilience', () => {
  it('单个状态文件删除抛错时不中断，其余状态文件仍被清理且不抛出', async () => {
    const mod = await import('../../routes/command-loop-runtime.js');

    // Per-session state path = a DIRECTORY → unlinkSync throws (EISDIR/EPERM).
    const sessionStateDirAsFile = join(
      workspaceRoot,
      `${STATE_FILE_PREFIX}.${SESSION_ID}${STATE_FILE_SUFFIX}`,
    );
    await mkdir(sessionStateDirAsFile, { recursive: true });
    // Put a child inside so a naive rm-as-file definitely can't succeed.
    await writeFile(join(sessionStateDirAsFile, 'keep.txt'), 'x', 'utf8');

    // Legacy state file (plain content → parses to null → eligible for delete).
    const legacyPath = join(workspaceRoot, LEGACY_OPENAWORK_STATE_FILE);
    await writeFile(legacyPath, 'not frontmatter, just text\n', 'utf8');

    // Must NOT throw despite the session state path being undeletable.
    expect(() => mod.clearPersistedLoopState(workspaceRoot, SESSION_ID)).not.toThrow();

    // The legacy file was still cleaned up — proving cleanup continued past the
    // throwing per-session entry.
    expect(existsSync(legacyPath)).toBe(false);
    // The undeletable directory is untouched (we swallowed its error).
    expect(existsSync(sessionStateDirAsFile)).toBe(true);
    const remaining = await readdir(sessionStateDirAsFile);
    expect(remaining).toContain('keep.txt');
  });
});
