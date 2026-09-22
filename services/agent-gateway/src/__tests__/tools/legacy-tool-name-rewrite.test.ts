import { describe, expect, it } from 'vitest';
import {
  rewriteLegacyToolRequest,
  stripFunctionsNamespacePrefix,
} from '../../tools/legacy-tool-name-rewrite.js';

/**
 * 硬约定：一个工具只有一个名字。
 *
 * 本模块**不承担任何改名职责**（唯一保留的是协议层的 `functions.` 前缀剥离）。
 * 下面的断言不列举任何历史名，而是用「恒等性质」兜住回归：只要有人重新引入
 * 「旧名 → 规范名」的映射，恒等断言立刻失败。
 */
describe('rewriteLegacyToolRequest', () => {
  it('任何不带 functions. 前缀的名字都必须恒等返回', () => {
    const liveNames = [
      'read',
      'list',
      'glob',
      'grep',
      'write',
      'edit',
      'multi_edit',
      'patch',
      'bash',
      'subagent',
      'Agent',
      'unknown_tool',
    ];
    const generated = Array.from({ length: 32 }, (_, index) => `probe_name_${index}`);

    for (const name of [...liveNames, ...generated]) {
      const out = rewriteLegacyToolRequest(name, { path: '/abs/file.txt', limit: 50 });
      expect(out.rewritten, name).toBe(false);
      expect(out.toolName, name).toBe(name);
      expect(out.rawInput).toEqual({ path: '/abs/file.txt', limit: 50 });
    }
  });

  it('strips a single functions. prefix so downstream dispatch sees the bare name', () => {
    const out = rewriteLegacyToolRequest('functions.bash', {
      command: 'node --version',
      workdir: '/abs',
    });
    expect(out.rewritten).toBe(true);
    expect(out.toolName).toBe('bash');
    expect(out.rawInput).toEqual({ command: 'node --version', workdir: '/abs' });
  });

  it('forwards non-object inputs untouched', () => {
    const out = rewriteLegacyToolRequest('functions.bash', null);
    expect(out.rewritten).toBe(true);
    expect(out.toolName).toBe('bash');
    expect(out.rawInput).toBeNull();
  });

  it('strips only a single prefix (functions.functions.x → functions.x)', () => {
    const out = rewriteLegacyToolRequest('functions.functions.bash', {});
    expect(out.rewritten).toBe(true);
    expect(out.toolName).toBe('functions.bash');
    expect(out.rawInput).toEqual({});
  });
});

describe('stripFunctionsNamespacePrefix', () => {
  it('mirrors the enablement-gate prefix rule', () => {
    expect(stripFunctionsNamespacePrefix('functions.Agent')).toBe('Agent');
    expect(stripFunctionsNamespacePrefix('bash')).toBe('bash');
    expect(stripFunctionsNamespacePrefix('functions.')).toBe('');
  });
});
