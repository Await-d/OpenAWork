// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSessionArtifactBlob } from './use-session-artifact-blob.js';

/**
 * 端点契约测试 —— 本文件的核心目的**不是**测加载流程，而是锁死「必须走会话级端点」。
 *
 * 背景：上传的附件是磁盘型产物，只有
 * `GET /sessions/:id/artifacts/:artifactId/content`（`downloadFromSession`）能读到；
 * `GET /artifacts/:id`（`get`）查的是 SQLite 内容型表，用它会稳定 404，而且因为组件
 * 有「失败即降级」的设计，**表现为静默失效**（卡片在、下载不了；音视频不播放）。
 *
 * 修复前本模块用的就是 `get`，且当时的测试没法发现 —— 所以这里必须显式断言
 * `get` 未被调用。
 */
const { downloadFromSession, get } = vi.hoisted(() => ({
  downloadFromSession: vi.fn(),
  get: vi.fn(),
}));

vi.mock('@openAwork/web-client', () => ({
  createArtifactsClient: () => ({ downloadFromSession, get }),
}));

vi.mock('../../../stores/auth/auth.js', () => ({
  useAuthStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ gatewayUrl: 'http://gateway.test', accessToken: 'token-1' }),
}));

const createObjectURL = vi.fn(() => 'blob:fake-url');
const revokeObjectURL = vi.fn();

beforeEach(() => {
  // jsdom 不实现 object URL API。
  Object.assign(URL, { createObjectURL, revokeObjectURL });
  downloadFromSession.mockResolvedValue(new Blob(['payload'], { type: 'application/pdf' }));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useSessionArtifactBlob', () => {
  it('走会话级端点：调用 downloadFromSession(token, sessionId, artifactId)，且不碰内容型端点', async () => {
    const { result } = renderHook(() => useSessionArtifactBlob('ses-1', 'art-1'));

    await waitFor(() => {
      expect(result.current.objectUrl).toBe('blob:fake-url');
    });

    expect(downloadFromSession).toHaveBeenCalledWith('token-1', 'ses-1', 'art-1');
    // ↓ 这就是回归防线：一旦有人改回 get()，这条断言立刻失败。
    expect(get).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('缺 sessionId 时不发请求 —— 宁可停在未就绪，也不发注定 404 的请求', () => {
    const { result } = renderHook(() => useSessionArtifactBlob(undefined, 'art-1'));

    expect(downloadFromSession).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(result.current.objectUrl).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('缺 artifactId 时同样不发请求', () => {
    renderHook(() => useSessionArtifactBlob('ses-1', undefined));

    expect(downloadFromSession).not.toHaveBeenCalled();
  });

  it('取流失败时暴露错误文案，且不产出 objectUrl', async () => {
    downloadFromSession.mockRejectedValue(new Error('404 not found'));

    const { result } = renderHook(() => useSessionArtifactBlob('ses-1', 'art-1'));

    await waitFor(() => {
      expect(result.current.error).toBe('404 not found');
    });
    expect(result.current.objectUrl).toBeNull();
  });

  it('卸载时回收 object URL（避免内存泄漏）', async () => {
    const { result, unmount } = renderHook(() => useSessionArtifactBlob('ses-1', 'art-1'));

    await waitFor(() => {
      expect(result.current.objectUrl).toBe('blob:fake-url');
    });

    unmount();

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });

  it('artifactId 变化时重取并回收上一个 URL', async () => {
    const { result, rerender } = renderHook(
      ({ artifactId }: { artifactId: string }) => useSessionArtifactBlob('ses-1', artifactId),
      { initialProps: { artifactId: 'art-1' } },
    );

    await waitFor(() => {
      expect(result.current.objectUrl).toBe('blob:fake-url');
    });

    createObjectURL.mockReturnValueOnce('blob:second-url');
    rerender({ artifactId: 'art-2' });

    await waitFor(() => {
      expect(result.current.objectUrl).toBe('blob:second-url');
    });

    expect(downloadFromSession).toHaveBeenLastCalledWith('token-1', 'ses-1', 'art-2');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });
});
