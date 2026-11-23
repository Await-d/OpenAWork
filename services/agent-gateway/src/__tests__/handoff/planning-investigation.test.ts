import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
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
      // 目录里必须有一个普通文件：只有隐藏文件时会被「空目录」短路直接返回，
      // 就走不到下面的重复动作保护了。
      await writeFile(join(directory, 'index.ts'), 'export const ok = true;');
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

  it('空目录直接返回「没有可调查的项目文件」，不消耗任何模型调用', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pm1-empty-'));
    try {
      let calls = 0;
      const result = await investigatePlanningProject({
        directory,
        intent: '调研一个空工作区',
        initialContext: '项目快照：（空）',
        signal: new AbortController().signal,
        callLlm: async () => {
          calls += 1;
          return JSON.stringify({ action: 'list', path: '.' });
        },
      });

      // 空目录若进入调查循环，模型只能反复请求 `.`，重复超限后会抛
      // 「项目调查无进展」——那是不可自动重试的终局失败，会把整条 handoff 拖死。
      expect(result).toContain('没有可调查的项目文件');
      expect(calls).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('只有隐藏文件与依赖目录时同样视为无可调查内容', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pm1-hidden-'));
    try {
      await writeFile(join(directory, '.env'), 'SECRET=hidden');
      await mkdir(join(directory, 'node_modules'));
      await mkdir(join(directory, 'dist'));
      let calls = 0;
      const result = await investigatePlanningProject({
        directory,
        intent: '调研',
        initialContext: '',
        signal: new AbortController().signal,
        callLlm: async () => {
          calls += 1;
          return JSON.stringify({ action: 'list', path: '.' });
        },
      });

      expect(result).toContain('没有可调查的项目文件');
      expect(calls).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('单次重复动作被纠正后模型可换路径继续调查', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pm1-repeat-'));
    try {
      await writeFile(join(directory, 'a.ts'), 'export const a = 1;');
      await writeFile(join(directory, 'b.ts'), 'export const b = 2;');
      let calls = 0;
      const result = await investigatePlanningProject({
        directory,
        intent: '调查两个文件',
        initialContext: '',
        signal: new AbortController().signal,
        callLlm: async (_system, prompt) => {
          calls += 1;
          if (calls <= 2) return JSON.stringify({ action: 'read', path: 'a.ts' });
          if (calls === 3) {
            expect(prompt).toContain('已忽略重复动作');
            expect(prompt).toContain('export const a = 1');
            return JSON.stringify({ action: 'read', path: 'b.ts' });
          }
          expect(prompt).toContain('export const b = 2');
          return JSON.stringify({ action: 'finish', summary: '已读取 a.ts 与 b.ts' });
        },
      });

      expect(result).toContain('已读取 a.ts 与 b.ts');
      expect(calls).toBe(4);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('持续重复同一动作超过容忍次数后仍判定无进展', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pm1-stuck-'));
    try {
      await writeFile(join(directory, 'a.ts'), 'export const a = 1;');
      let calls = 0;
      await expect(
        investigatePlanningProject({
          directory,
          intent: '调查',
          initialContext: '',
          signal: new AbortController().signal,
          callLlm: async () => {
            calls += 1;
            return JSON.stringify({ action: 'read', path: 'a.ts' });
          },
        }),
      ).rejects.toThrow('项目调查无进展：a.ts');
      expect(calls).toBe(4);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('调查动作首次回复非 JSON 时带上一次输出重试并完成调查', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pm1-repair-'));
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
          if (calls === 1) return '我觉得这个项目挺好的';
          if (calls === 2) {
            expect(prompt).toContain('上一次输出无法解析为 JSON');
            expect(prompt).toContain('我觉得这个项目挺好的');
            return JSON.stringify({ action: 'finish', summary: '依据快照直接收尾' });
          }
          throw new Error(`意外调用：${calls}`);
        },
      });
      expect(result).toContain('调查结论');
      expect(calls).toBe(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('调查动作持续非 JSON 时失败并保留原始输出片段', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pm1-garbage-'));
    try {
      // 目录里要有可调查文件，否则会被「空目录」短路，走不到 JSON 修复重试这条路径。
      await writeFile(join(directory, 'index.ts'), 'export const ok = true;');
      let calls = 0;
      const failure = investigatePlanningProject({
        directory,
        intent: '调查',
        initialContext: '',
        signal: new AbortController().signal,
        callLlm: async () => {
          calls += 1;
          return '这不是一个 JSON 对象';
        },
      });
      await expect(failure).rejects.toThrowError(/项目调查返回无效 JSON：.+/);
      await expect(failure).rejects.toThrow('这不是一个 JSON 对象');
      const rejection = await failure.then(
        () => null,
        (error: unknown) => error,
      );
      expect(String(rejection)).not.toContain('需要用户介入');
      expect(calls).toBe(3);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('收尾首次回复非 JSON 时带上一次输出重试并完成收尾', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pm1-finalize-repair-'));
    try {
      for (let index = 0; index < 6; index += 1)
        await writeFile(join(directory, `${index}.ts`), `export const n = ${index};`);
      let calls = 0;
      const result = await investigatePlanningProject({
        directory,
        intent: '调查',
        initialContext: '',
        signal: new AbortController().signal,
        callLlm: async (_system, prompt) => {
          calls += 1;
          if (calls <= 6) return JSON.stringify({ action: 'read', path: `${calls - 1}.ts` });
          if (calls === 7) return '结论无法序列化';
          expect(calls).toBe(8);
          expect(prompt).toContain('上一次输出无法解析为 JSON');
          expect(prompt).toContain('结论无法序列化');
          return JSON.stringify({ sufficient: true, summary: '基于六个文件的证据结论' });
        },
      });
      expect(result).toContain('调查结论');
      expect(calls).toBe(8);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
