/**
 * Regression (§0.127, workspace context-file memory bound):
 * buildWorkspaceContext reads project rule files, AGENTS.md, and README.md on
 * EVERY turn and concatenates their content verbatim into the system prompt.
 * The reads were unguarded `fsp.readFile`, so a pathological multi-MB
 * rule/README/AGENTS file would balloon gateway memory and every upstream
 * request. The reads now `stat` first and skip any file over the cap (like
 * look_at / the workspace search). We seed an oversized AGENTS.md + a small
 * README and assert only the small one is injected.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as StreamModule from '../../routes/stream.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let buildWorkspaceContext: typeof StreamModule.buildWorkspaceContext;
let tempDir = '';

beforeAll(async () => {
  const dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  buildWorkspaceContext = (await import('../../routes/stream.js')).buildWorkspaceContext;
});

afterAll(async () => {
  const dbModule = await import('../../infra/db.js');
  await dbModule.closeDb();
});

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'openawork-context-file-limit-'));
});

afterEach(() => {
  delete process.env['OPENAWORK_CONTEXT_FILE_MAX_BYTES'];
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe('buildWorkspaceContext context-file size bound', () => {
  it('超过上限的 AGENTS.md 被跳过，未超限的 README.md 仍注入', async () => {
    // Tiny cap so a modest file trips the guard deterministically.
    process.env['OPENAWORK_CONTEXT_FILE_MAX_BYTES'] = '128';
    // Oversized AGENTS.md (well past the 128-byte cap).
    writeFileSync(join(tempDir, 'AGENTS.md'), 'A'.repeat(50_000), 'utf8');
    // Small README.md within the cap.
    writeFileSync(join(tempDir, 'README.md'), '# Hello small readme', 'utf8');

    const context = await buildWorkspaceContext(JSON.stringify({ workingDirectory: tempDir }));

    expect(context).not.toBeNull();
    // The oversized AGENTS.md must NOT be injected.
    expect(context).not.toContain('AAAAA');
    expect(context).not.toContain('directory_agents');
    // The small README is still injected.
    expect(context).toContain('Hello small readme');
  });

  it('上限内的 AGENTS.md 正常注入（保证守卫不误伤正常文件）', async () => {
    process.env['OPENAWORK_CONTEXT_FILE_MAX_BYTES'] = '1048576';
    writeFileSync(join(tempDir, 'AGENTS.md'), '# Project agent guide', 'utf8');

    const context = await buildWorkspaceContext(JSON.stringify({ workingDirectory: tempDir }));

    expect(context).toContain('directory_agents');
    expect(context).toContain('Project agent guide');
  });
});
