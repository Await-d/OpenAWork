import { describe, expect, it } from 'vitest';
import {
  buildBannedCommandWarning,
  checkNonInteractiveBash,
  NON_INTERACTIVE_ENV_KEYS,
  withNonInteractiveEnv,
} from '../../workspace/non-interactive-env.js';

describe('withNonInteractiveEnv', () => {
  it('为缺失的键补齐非交互兜底值', () => {
    const merged = withNonInteractiveEnv({ PATH: '/usr/bin' });

    expect(merged['GIT_EDITOR']).toBe('true');
    expect(merged['VISUAL']).toBe('true');
    expect(merged['EDITOR']).toBe('true');
    expect(merged['GIT_PAGER']).toBe('cat');
    expect(merged['PAGER']).toBe('cat');
    expect(merged['GIT_TERMINAL_PROMPT']).toBe('0');
    expect(merged['PATH']).toBe('/usr/bin');
  });

  it('保留调用方显式配置（用户自己的 GIT_EDITOR 不被抹掉）', () => {
    const merged = withNonInteractiveEnv({ GIT_EDITOR: 'code -w', PAGER: 'less' });

    expect(merged['GIT_EDITOR']).toBe('code -w');
    expect(merged['PAGER']).toBe('less');
    expect(merged['GIT_TERMINAL_PROMPT']).toBe('0');
  });

  it('空字符串视为未设置并回填', () => {
    const merged = withNonInteractiveEnv({ GIT_PAGER: '', GIT_EDITOR: undefined });

    expect(merged['GIT_PAGER']).toBe('cat');
    expect(merged['GIT_EDITOR']).toBe('true');
  });

  it('不修改传入对象', () => {
    const base: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
    withNonInteractiveEnv(base);

    expect(base['GIT_EDITOR']).toBeUndefined();
    expect(Object.keys(base)).toEqual(['PATH']);
  });

  it('覆盖全部受管键（无遗漏）', () => {
    const merged = withNonInteractiveEnv({});

    for (const key of NON_INTERACTIVE_ENV_KEYS) {
      expect(merged[key]).toBeTypeOf('string');
      expect(merged[key]).not.toBe('');
    }
  });
});

describe('checkNonInteractiveBash', () => {
  it('不再改写命令字符串（Windows PowerShell 不识别 VAR=value 前缀）', () => {
    const result = checkNonInteractiveBash('git diff --stat -- frontend/pnpm-lock.yaml');

    expect(result).toEqual({ hasBannedCommand: false });
    expect(result).not.toHaveProperty('modifiedCommand');
  });

  it('仍然识别被禁用的交互式命令', () => {
    const result = checkNonInteractiveBash('vim src/index.ts && git add -A');

    expect(result.hasBannedCommand).toBe(true);
    expect(result.bannedCommand).toBe('vim');
    expect(buildBannedCommandWarning('vim')).toContain('非交互环境警告');
  });

  it('普通命令不触发禁用警告', () => {
    expect(checkNonInteractiveBash('git status --short')).toEqual({ hasBannedCommand: false });
  });
});
