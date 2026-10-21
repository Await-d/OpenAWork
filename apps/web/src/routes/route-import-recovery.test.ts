import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearRouteImportFailureFlag,
  reloadOnceForRouteImportFailure,
} from './route-import-recovery.js';

describe('reloadOnceForRouteImportFailure', () => {
  const reload = vi.fn();

  beforeEach(() => {
    window.sessionStorage.clear();
    reload.mockReset();
    vi.stubGlobal('location', { reload });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it('首次失败触发整页刷新', () => {
    expect(reloadOnceForRouteImportFailure('chat')).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('同一路由在会话内只刷新一次，避免刷新风暴', () => {
    expect(reloadOnceForRouteImportFailure('chat')).toBe(true);
    expect(reloadOnceForRouteImportFailure('chat')).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('不同路由各自拥有一次刷新机会', () => {
    expect(reloadOnceForRouteImportFailure('chat')).toBe(true);
    expect(reloadOnceForRouteImportFailure('settings')).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('加载成功后清除标记，下一次故障仍可自愈', () => {
    reloadOnceForRouteImportFailure('chat');
    clearRouteImportFailureFlag('chat');
    expect(reloadOnceForRouteImportFailure('chat')).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
