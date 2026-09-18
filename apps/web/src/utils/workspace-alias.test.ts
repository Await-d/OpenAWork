import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readWorkspaceAlias,
  resolveWorkspaceDisplayName,
  subscribeWorkspaceAlias,
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
