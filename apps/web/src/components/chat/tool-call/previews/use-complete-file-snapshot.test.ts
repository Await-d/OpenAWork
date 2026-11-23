// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getFileChanges } = vi.hoisted(() => ({ getFileChanges: vi.fn() }));

vi.mock('@openAwork/web-client', () => ({
  createSessionsClient: () => ({ getFileChanges }),
}));

import { useAuthStore } from '../../../../stores/auth/auth.js';
import { useCompleteFileSnapshot } from './use-complete-file-snapshot.js';

const SESSION_ID = 'session-1';
const ABSOLUTE = '/repo/apps/web/src/x.ts';

function projectionWith(file: string, before: string, after: string) {
  return {
    fileDiffs: [{ file, before, after, additions: 1, deletions: 1 }],
    snapshots: [],
    summary: {},
  };
}

beforeEach(() => {
  useAuthStore.setState({ accessToken: 'token-abc', gatewayUrl: 'http://127.0.0.1:3000' });
});

afterEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ accessToken: null });
});

describe('useCompleteFileSnapshot · 状态机', () => {
  it('挂载时绝不自动取数（完整 diff 可能有几 MB，只能由用户点击触发）', () => {
    const { result } = renderHook(() => useCompleteFileSnapshot(SESSION_ID));
    expect(result.current.status).toBe('idle');
    expect(result.current.snapshot).toBeNull();
    expect(result.current.error).toBeNull();
    expect(getFileChanges).not.toHaveBeenCalled();
  });

  it('点击后 loading → loaded，拿到完整 before/after 与服务端计数', async () => {
    getFileChanges.mockResolvedValue(projectionWith(ABSOLUTE, 'full-before', 'full-after'));
    const { result } = renderHook(() => useCompleteFileSnapshot(SESSION_ID));

    act(() => result.current.load('apps/web/src/x.ts'));
    expect(result.current.status).toBe('loading');

    await waitFor(() => expect(result.current.status).toBe('loaded'));
    expect(result.current.snapshot).toEqual({
      before: 'full-before',
      after: 'full-after',
      additions: 1,
      deletions: 1,
    });
    expect(getFileChanges).toHaveBeenCalledTimes(1);
    expect(getFileChanges).toHaveBeenCalledWith('token-abc', SESSION_ID, {
      includeText: true,
      signal: expect.any(AbortSignal),
    });
  });

  it('同一 filePath 第二次点击命中缓存，不重复请求', async () => {
    getFileChanges.mockResolvedValue(projectionWith(ABSOLUTE, 'b', 'a'));
    const { result } = renderHook(() => useCompleteFileSnapshot(SESSION_ID));

    act(() => result.current.load(ABSOLUTE));
    await waitFor(() => expect(result.current.status).toBe('loaded'));

    act(() => result.current.reset());
    expect(result.current.status).toBe('idle');

    act(() => result.current.load(ABSOLUTE));
    expect(result.current.status).toBe('loaded');
    expect(getFileChanges).toHaveBeenCalledTimes(1);
  });

  it('定位不到文件时进入 error 并给出明确文案（不静默展示旧数据）', async () => {
    getFileChanges.mockResolvedValue(projectionWith('/repo/other.ts', 'b', 'a'));
    const { result } = renderHook(() => useCompleteFileSnapshot(SESSION_ID));

    act(() => result.current.load('apps/web/src/x.ts'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('未能定位该文件的完整快照');
    expect(result.current.snapshot).toBeNull();
  });

  it('两侧都没有文本时同样报「不可用」，不会伪造空文件', async () => {
    getFileChanges.mockResolvedValue({
      fileDiffs: [{ file: ABSOLUTE, additions: 0, deletions: 0 }],
      snapshots: [],
      summary: {},
    });
    const { result } = renderHook(() => useCompleteFileSnapshot(SESSION_ID));

    act(() => result.current.load(ABSOLUTE));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('网关未返回该文件的完整内容');
  });

  it('网络错误冒到 UI（按钮不会永远转圈）', async () => {
    getFileChanges.mockRejectedValue(new Error('网关不可达'));
    const { result } = renderHook(() => useCompleteFileSnapshot(SESSION_ID));

    act(() => result.current.load(ABSOLUTE));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('网关不可达');
  });

  it('缺 sessionId 时直接报错，不发注定 404 的请求', () => {
    const { result } = renderHook(() => useCompleteFileSnapshot(undefined));
    act(() => result.current.load(ABSOLUTE));
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('缺少会话上下文，无法加载完整内容');
    expect(getFileChanges).not.toHaveBeenCalled();
  });

  it('卸载后不再回写状态（abort 不算错误）', async () => {
    let rejectLoad: ((error: unknown) => void) | undefined;
    getFileChanges.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectLoad = reject;
        }),
    );
    const { result, unmount } = renderHook(() => useCompleteFileSnapshot(SESSION_ID));

    act(() => result.current.load(ABSOLUTE));
    expect(result.current.status).toBe('loading');
    unmount();
    await act(async () => {
      rejectLoad?.(new DOMException('aborted', 'AbortError'));
    });
    expect(result.current.status).toBe('loading');
  });
});
