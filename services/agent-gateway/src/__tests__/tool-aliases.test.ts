import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const workspaceRoot = vi.hoisted(
  () => `/tmp/gateway-tool-aliases-${Math.random().toString(36).slice(2)}`,
);

vi.mock('../db.js', () => ({
  WORKSPACE_ACCESS_RESTRICTED: true,
  WORKSPACE_ROOT: workspaceRoot,
  WORKSPACE_ROOTS: [workspaceRoot],
}));

import { fileReadTool, writeFileTool } from '../tool-aliases.js';

describe('legacy file tool aliases', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts filePath-based legacy write and read inputs', async () => {
    mkdirSync(workspaceRoot, { recursive: true });
    const filePath = join(workspaceRoot, 'legacy.txt');

    const writeResult = await writeFileTool.execute(
      {
        filePath,
        content: 'alpha\nbeta\ngamma\ndelta',
      },
      new AbortController().signal,
    );
    expect(writeResult.success).toBe(true);

    const readResult = await fileReadTool.execute(
      {
        filePath,
        offset: 2,
        limit: 2,
      },
      new AbortController().signal,
    );
    expect(readResult.path).toBe(filePath);
    expect(readResult.content).toContain('2: beta');
    expect(readResult.content).toContain('3: gamma');
    expect(readResult.content).not.toContain('1: alpha');
  });

  it('supports directory reads with offset and limit', async () => {
    mkdirSync(workspaceRoot, { recursive: true });
    writeFileSync(join(workspaceRoot, 'a.txt'), 'a');
    writeFileSync(join(workspaceRoot, 'b.txt'), 'b');
    writeFileSync(join(workspaceRoot, 'c.txt'), 'c');

    const result = await fileReadTool.execute(
      {
        filePath: workspaceRoot,
        offset: 2,
        limit: 1,
      },
      new AbortController().signal,
    );

    expect(result.content.split('\n')).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });

  it('uses numbered legacy output even without offset and limit', async () => {
    mkdirSync(workspaceRoot, { recursive: true });
    const filePath = join(workspaceRoot, 'default-read.txt');
    writeFileSync(filePath, 'first\nsecond');

    const result = await fileReadTool.execute(
      {
        filePath,
      },
      new AbortController().signal,
    );

    expect(result.content).toContain('1: first');
    expect(result.content).toContain('2: second');
  });
});
