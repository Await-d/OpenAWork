import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { whichSync } from './server.js';

/**
 * Regression: binary resolution must be a pure-Node PATH scan, not an
 * unbounded `execSync('which … || where …')` subprocess. The old form ran on
 * the LSP spawn path with no timeout (a hung which/where blocks the whole
 * event loop) and interpolated the binary name into a shell string. These
 * tests pin that whichSync resolves a real on-PATH executable, rejects a
 * missing one, and treats the binary name literally (no shell execution).
 */

const isWindows = process.platform === 'win32';

let dir: string;
let savedPath: string | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'which-sync-'));
  savedPath = process.env['PATH'];
});

afterEach(async () => {
  if (savedPath === undefined) delete process.env['PATH'];
  else process.env['PATH'] = savedPath;
  await rm(dir, { recursive: true, force: true }).catch(() => {});
});

describe.skipIf(isWindows)('whichSync pure-Node PATH scan', () => {
  it('resolves an executable file that lives on PATH', async () => {
    const binName = 'fake-lsp-bin';
    const binPath = join(dir, binName);
    await writeFile(binPath, '#!/bin/sh\necho hi\n', 'utf8');
    await chmod(binPath, 0o755);
    process.env['PATH'] = dir;

    expect(whichSync(binName)).toBe(binPath);
  });

  it('returns undefined for a binary that is not on PATH', () => {
    process.env['PATH'] = dir;
    expect(whichSync('definitely-not-a-real-binary-xyz')).toBeUndefined();
  });

  it('does not treat a non-executable file as a match', async () => {
    const binName = 'not-exec';
    const binPath = join(dir, binName);
    await writeFile(binPath, 'plain text\n', 'utf8');
    await chmod(binPath, 0o644);
    process.env['PATH'] = dir;

    expect(whichSync(binName)).toBeUndefined();
  });

  it('treats the binary name literally (no shell metacharacter execution)', () => {
    process.env['PATH'] = dir;
    // A name with shell metacharacters must simply not resolve, never execute.
    expect(whichSync('foo; echo pwned')).toBeUndefined();
    expect(whichSync('$(touch /tmp/whichsync-pwned)')).toBeUndefined();
  });
});
