import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { investigatePlanningProject } from '../../handoff/runner/planning-investigation.js';

describe('PM1 自主只读调查', () => {
  it.each([true, false])('六轮后关闭工具并按证据充分性收尾：%s', async (sufficient) => {
    const directory = await mkdtemp(join(tmpdir(), 'pm1-finalize-'));
    try {
      for (let index = 0; index < 6; index += 1)
        await writeFile(join(directory, `${index}.ts`), `export const n = ${index};`);
      let calls = 0;
      const result = investigatePlanningProject({
        directory,
        intent: '调查',
        initialContext: '',
        signal: new AbortController().signal,
        callLlm: async (system, prompt) => {
          calls += 1;
          if (calls <= 6) return JSON.stringify({ action: 'read', path: `${calls - 1}.ts` });
          expect(system).toContain('工具已关闭');
          expect(prompt).toContain('export const n = 5');
          return JSON.stringify({ sufficient, summary: '基于六个文件的证据结论' });
        },
      });
      if (sufficient) await expect(result).resolves.toContain('调查结论');
      else await expect(result).rejects.toThrow('调查证据不足');
      expect(calls).toBe(7);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('将实际读取的代码反馈给下一轮模型并完成调查', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pm1-investigate-'));
    try {
      await writeFile(join(directory, 'main.ts'), 'export const answer = 42;');
      let calls = 0;
      const result = await investigatePlanningProject({
        directory,
        intent: '理解入口',
        initialContext: 'main.ts',
        signal: new AbortController().signal,
        callLlm: async (_system, prompt) => {
          calls += 1;
          if (calls === 1) return JSON.stringify({ action: 'read', path: 'main.ts' });
          expect(prompt).toContain('answer = 42');
          return JSON.stringify({ action: 'finish', summary: 'main.ts 导出 answer，值为 42' });
        },
      });
      expect(result).toContain('调查结论');
      expect(calls).toBe(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('拒绝秘密文件并在重复动作时停止', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pm1-investigate-'));
    try {
      await writeFile(join(directory, '.env'), 'SECRET=hidden');
      await expect(
        investigatePlanningProject({
          directory,
          intent: '调查',
          initialContext: '',
          signal: new AbortController().signal,
          callLlm: async (_system, prompt) => {
            expect(prompt).not.toContain('SECRET=hidden');
            return JSON.stringify({ action: 'read', path: '.env' });
          },
        }),
      ).rejects.toThrow('项目调查无进展');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
