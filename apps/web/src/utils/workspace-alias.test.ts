import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WORKSPACE_ALIAS_MAX_LENGTH,
  readWorkspaceAlias,
  resolveWorkspaceDisplayName,
  subscribeWorkspaceAlias,
  validateWorkspaceAlias,
  writeWorkspaceAlias,
} from './workspace-alias.js';

const OPENAWORK_PATH = '/home/await/project/OpenAWork';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('workspace-alias', () => {
  it('未设置别名时展示名回落到路径末段', () => {
    expect(readWorkspaceAlias(OPENAWORK_PATH)).toBe('');
    expect(resolveWorkspaceDisplayName(OPENAWORK_PATH)).toBe('OpenAWork');
  });

  it('别名优先于路径末段，清空后回落', () => {
    writeWorkspaceAlias(OPENAWORK_PATH, '我的项目');

    expect(readWorkspaceAlias(OPENAWORK_PATH)).toBe('我的项目');
    expect(resolveWorkspaceDisplayName(OPENAWORK_PATH)).toBe('我的项目');

    writeWorkspaceAlias(OPENAWORK_PATH, '');

    expect(readWorkspaceAlias(OPENAWORK_PATH)).toBe('');
    expect(resolveWorkspaceDisplayName(OPENAWORK_PATH)).toBe('OpenAWork');
  });

  it('未选择工作区时不写入任何键', () => {
    writeWorkspaceAlias(null, '不应写入');

    expect(localStorage.length).toBe(0);
    expect(readWorkspaceAlias(null)).toBe('');
  });

  it('写入时通知订阅者，取消订阅后不再通知', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWorkspaceAlias(listener);

    writeWorkspaceAlias(OPENAWORK_PATH, '我的项目');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();

    writeWorkspaceAlias(OPENAWORK_PATH, '改名后');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('validateWorkspaceAlias', () => {
  it('空输入视为清除别名（恢复默认名）', () => {
    expect(validateWorkspaceAlias('   ')).toEqual({ ok: true, alias: '' });
  });

  it('去除首尾空白后返回规范名', () => {
    expect(validateWorkspaceAlias('  我的项目  ')).toEqual({ ok: true, alias: '我的项目' });
  });

  it('超过长度上限时拒绝并给出原因', () => {
    const tooLong = 'x'.repeat(WORKSPACE_ALIAS_MAX_LENGTH + 1);
    const result = validateWorkspaceAlias(tooLong);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain(String(WORKSPACE_ALIAS_MAX_LENGTH));
    expect(validateWorkspaceAlias('x'.repeat(WORKSPACE_ALIAS_MAX_LENGTH)).ok).toBe(true);
  });

  it('拒绝含换行 / 制表符的名称', () => {
    expect(validateWorkspaceAlias('我的\n项目').ok).toBe(false);
    expect(validateWorkspaceAlias('我的\t项目').ok).toBe(false);
  });
});
