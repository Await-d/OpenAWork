import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectPlanningProjectContext } from '../../handoff/runner/planning-project-context.js';

describe('规划项目证据', () => {
  it('收集目录与脚本并排除依赖和环境密钥', async () => {
    const root = await mkdtemp(join(tmpdir(), 'planning-context-'));
    try {
      await mkdir(join(root, 'src'));
      await mkdir(join(root, 'node_modules'));
      await writeFile(join(root, 'src', 'main.ts'), 'export const main = 1;');
      await writeFile(join(root, '.env'), 'SECRET=must-not-read');
      await writeFile(join(root, 'node_modules', 'private.txt'), 'dependency');
      await writeFile(join(root, 'package.json'), '{"scripts":{"test":"vitest run"}}');
      const context = await collectPlanningProjectContext(root);
      expect(context).toContain('main.ts');
      expect(context).toContain('vitest run');
      expect(context).not.toContain('must-not-read');
      expect(context).not.toContain('private.txt');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
