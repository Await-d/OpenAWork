import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceFileMentionItem } from '../../../../components/conversation-runtime/messages/support.js';

const fetchTree = vi.fn();

const { useChatDataLoaders } = await import('./use-chat-data-loaders.js');

const WS_A = '/home/user/project-a';
const WS_B = '/home/user/project-b';
const NULL_GRACE_MS = 1500;

/** 必须是 `type: 'file'` 节点：`flattenWorkspaceFiles` 不产出目录行。 */
function makeTree(path: string) {
  return [{ name: 'index.ts', path: `${path}/index.ts`, type: 'file' }];
}

function makeItems(path: string): WorkspaceFileMentionItem[] {
  return [{ path: `${path}/index.ts`, label: 'index.ts', relativePath: 'index.ts' }];
}

type LoaderProps = Parameters<typeof useChatDataLoaders>[0];

/** 复用同一批 mock，避免每次 rerender 换引用（那会掩盖依赖稳定性问题）。 */
function createHarness() {
  const setWorkspaceFileItems = vi.fn<(value: WorkspaceFileMentionItem[]) => void>();
  const depsFor = (overrides: Partial<LoaderProps> = {}): LoaderProps => ({
    currentSessionId: 's1',
    effectiveWorkingDirectory: WS_A,
    workspace: { fetchTree },
    workspaceTreeVersion: 0,
    setWorkspaceFileItems,
    token: 'token-1',
    gatewayUrl: 'http://localhost:3000',
    rightOpen: false,
    rightTab: 'overview',
    setMcpServers: vi.fn(),
    ...overrides,
  });

  return { setWorkspaceFileItems, depsFor };
}

describe('useChatDataLoaders 工作区文件树', () => {
  beforeEach(() => {
    fetchTree.mockReset();
    fetchTree.mockResolvedValue(makeTree(WS_A));
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('首次进入按有效工作目录拉取并写入文件列表', async () => {
    const { setWorkspaceFileItems, depsFor: make } = createHarness();
    renderHook((p: LoaderProps) => useChatDataLoaders(p), { initialProps: make() });

    await waitFor(() => expect(fetchTree).toHaveBeenCalledTimes(1));
    expect(fetchTree).toHaveBeenCalledWith(WS_A, 2);
    await waitFor(() => expect(setWorkspaceFileItems).toHaveBeenCalledWith(makeItems(WS_A)));
  });

  it('同工作区切会话（path → null → path）不重取，也不清空列表', async () => {
    const { setWorkspaceFileItems, depsFor: make } = createHarness();
    const { rerender } = renderHook((p: LoaderProps) => useChatDataLoaders(p), {
      initialProps: make(),
    });
    await waitFor(() => expect(fetchTree).toHaveBeenCalledTimes(1));
    setWorkspaceFileItems.mockClear();

    // 切换中转：工作区解析未落定，effectiveWorkingDirectory 短暂为 null
    await act(async () => {
      rerender(make({ currentSessionId: 's2', effectiveWorkingDirectory: null }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    // 宽限期内：不请求、也不清空
    expect(fetchTree).toHaveBeenCalledTimes(1);
    expect(setWorkspaceFileItems).not.toHaveBeenCalled();

    // 工作区解析落定，回到同一目录
    await act(async () => {
      rerender(make({ currentSessionId: 's2', effectiveWorkingDirectory: WS_A }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NULL_GRACE_MS * 2);
    });

    // 全程 1 次请求：同目录的树仍然有效
    expect(fetchTree).toHaveBeenCalledTimes(1);
    expect(setWorkspaceFileItems).not.toHaveBeenCalled();
  });

  it('切换到不同工作区时重新拉取', async () => {
    const { depsFor: make } = createHarness();
    const { rerender } = renderHook((p: LoaderProps) => useChatDataLoaders(p), {
      initialProps: make(),
    });
    await waitFor(() => expect(fetchTree).toHaveBeenCalledTimes(1));

    await act(async () => {
      rerender(make({ currentSessionId: 's2', effectiveWorkingDirectory: WS_B }));
    });

    await waitFor(() => expect(fetchTree).toHaveBeenCalledTimes(2));
    expect(fetchTree).toHaveBeenLastCalledWith(WS_B, 2);
  });

  it('工作目录为空超过宽限期后清空列表（确实无工作区会话）', async () => {
    const { setWorkspaceFileItems, depsFor: make } = createHarness();
    const { rerender } = renderHook((p: LoaderProps) => useChatDataLoaders(p), {
      initialProps: make(),
    });
    await waitFor(() => expect(fetchTree).toHaveBeenCalledTimes(1));
    setWorkspaceFileItems.mockClear();

    await act(async () => {
      rerender(make({ currentSessionId: 's2', effectiveWorkingDirectory: null }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(setWorkspaceFileItems).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(NULL_GRACE_MS + 100);
    });

    expect(setWorkspaceFileItems).toHaveBeenCalledWith([]);
  });

  it('从未绑定过工作区时保持空列表（不走宽限延迟）', () => {
    const { setWorkspaceFileItems, depsFor: make } = createHarness();
    renderHook((p: LoaderProps) => useChatDataLoaders(p), {
      initialProps: make({ effectiveWorkingDirectory: null }),
    });

    expect(fetchTree).not.toHaveBeenCalled();
    expect(setWorkspaceFileItems).toHaveBeenCalledWith([]);
  });

  it('树版本 bump 时强制重取，即使目录没变', async () => {
    const { depsFor: make } = createHarness();
    const { rerender } = renderHook((p: LoaderProps) => useChatDataLoaders(p), {
      initialProps: make(),
    });
    await waitFor(() => expect(fetchTree).toHaveBeenCalledTimes(1));

    await act(async () => {
      rerender(make({ workspaceTreeVersion: 1 }));
    });

    await waitFor(() => expect(fetchTree).toHaveBeenCalledTimes(2));
  });

  it('拉取失败后允许下次重试', async () => {
    fetchTree.mockRejectedValueOnce(new Error('boom'));
    const { setWorkspaceFileItems, depsFor: make } = createHarness();
    const { rerender } = renderHook((p: LoaderProps) => useChatDataLoaders(p), {
      initialProps: make(),
    });

    await waitFor(() => expect(setWorkspaceFileItems).toHaveBeenCalledWith([]));

    await act(async () => {
      rerender(make({ effectiveWorkingDirectory: WS_B }));
    });

    await waitFor(() => expect(fetchTree).toHaveBeenCalledTimes(2));
  });
});
