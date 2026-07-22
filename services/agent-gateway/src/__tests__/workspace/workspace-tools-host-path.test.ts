import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { executeGrepTool, executeReadTool, readTool } from '../../tools/workspace-tools.js';

const testOnNonWindows = process.platform === 'win32' ? it.skip : it;

describe('workspace file tools on non-Windows hosts', () => {
  it('ignores an empty filePath when a valid path is provided', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openawork-read-'));
    const filePath = join(directory, 'document.md');
    try {
      await writeFile(filePath, 'document content\n', 'utf8');

      const parsed = readTool.inputSchema.safeParse({ path: filePath, filePath: '' });

      expect(parsed.success).toBe(true);
      if (!parsed.success) return;

      const result = await executeReadTool(parsed.data);
      expect(result.content).toBe('document content\n');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('accepts the PCRE inline case-insensitive prefix in grep patterns', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openawork-grep-'));
    const filePath = join(directory, 'camera.txt');
    try {
      await writeFile(filePath, 'VideoMonitor is ready\n', 'utf8');

      const result = await executeGrepTool({
        pattern: '(?i)(videomonitor|camera)',
        path: directory,
        output_mode: 'content',
        head_limit: 10,
      });

      expect(result).toContain(`${filePath}:1: VideoMonitor is ready`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('matches nested files when grep include uses a basename glob like *.cs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openawork-grep-include-'));
    const nestedDirectory = join(directory, 'src', 'tree');
    const filePath = join(nestedDirectory, 'loader.cs');
    try {
      await mkdir(nestedDirectory, { recursive: true });
      await writeFile(filePath, 'GetTreeMenuBatch();\n', 'utf8');

      const result = await executeGrepTool({
        pattern: 'GetTreeMenuBatch\\(',
        path: directory,
        include: '*.cs',
        output_mode: 'content',
        head_limit: 10,
      });

      expect(result).toContain(`${filePath}:1: GetTreeMenuBatch();`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  testOnNonWindows('rejects a Windows path before attempting filesystem access', async () => {
    await expect(
      executeReadTool({
        path: 'E:\\01Project\\appearance-automation\\appearance-automation-web-react\\src\\App.tsx',
      }),
    ).rejects.toThrow(/当前网关运行在 Linux，无法访问 Windows 路径/);
  });

  testOnNonWindows('rejects a Windows grep root before attempting filesystem access', async () => {
    await expect(
      executeGrepTool({
        pattern: 'GetTreeMenuBatch\\(',
        path: 'E:\\01Project\\appearance-automation\\Project\\appearance-automation',
        output_mode: 'content',
        head_limit: 50,
        include: '*.cs',
      }),
    ).rejects.toThrow(/当前网关运行在 Linux，无法访问 Windows 路径/);
  });
});
