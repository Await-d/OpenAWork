// @vitest-environment jsdom
/**
 * useChatUiState v0.1 骨架测试
 *
 * 覆盖：
 * 1. 初始返回值与 zustand store 默认值一致（rightOpen / rightTab / editorMode）
 * 2. setter / 函数式 setter 都能透传到 zustand
 * 3. workspace-keyed 字段（browserPreviewUrl / editorPaneTab / quickTerminalOpen）
 *    在指定 workspace 桶下读写互不影响
 * 4. setBrowserPreviewUrl 同步把 browserActive 置为 true
 * 5. bumpCompanionPanelSignal 单调递增
 * 6. rightOpenRef 与 rightOpen 保持镜像
 * 7. sidebar 子集字段（透传自 useChatSidebarLayout）可访问
 *
 * 参考：use-chat-conversation-state.test.tsx 的渲染风格。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { resolveChatUiWorkspaceScope, useChatUiState } from './use-chat-ui-state.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';

const WS_A = '/workspace/alpha';
const WS_B = '/workspace/beta';

/**
 * 把 zustand store 的 UI 状态字段重置回相关测试需要的"干净"基线。
 * 只重置我们这个 hook 关心的字段，避免污染其他 store 状态。
 */
function resetUiStateStore() {
  useUIStateStore.setState({
    chatView: 'home',
    rightOpen: false,
    rightTab: 'overview',
    editorMode: false,
    browserActive: false,
    browserPreviewUrlByWorkspace: {},
    editorPaneTabByWorkspace: {},
    quickTerminalOpenByWorkspace: {},
    leftSidebarOpen: true,
  });
}

beforeEach(() => {
  resetUiStateStore();
});

afterEach(() => {
  cleanup();
});

describe('useChatUiState — 初始值', () => {
  it('返回与 zustand 默认值一致的右侧面板 / 编辑器模式状态', () => {
    const { result } = renderHook(() => useChatUiState({ effectiveWorkingDirectory: WS_A }));

    expect(result.current.rightOpen).toBe(false);
    expect(result.current.rightTab).toBe('overview');
    expect(result.current.editorMode).toBe(false);
    expect(result.current.browserPreviewUrl).toBeNull();
    expect(result.current.editorPaneTab).toBe('code');
    expect(result.current.quickTerminalOpen).toBe(false);
    expect(result.current.toolFilter).toBe('all');
    expect(result.current.mcpServers).toEqual([]);
    expect(result.current.saving).toBe(false);
    expect(result.current.showWorkspaceSelector).toBe(false);
    expect(result.current.showScrollToBottom).toBe(false);
    expect(result.current.companionPanelSignal).toBe(0);
  });

  it('splitPos 走独立 localStorage 键，初始落在 20-80 的合法范围内', () => {
    const { result } = renderHook(() => useChatUiState({ effectiveWorkingDirectory: null }));
    expect(result.current.splitPos).toBeGreaterThanOrEqual(20);
    expect(result.current.splitPos).toBeLessThanOrEqual(80);
  });

  it('refs 字段都被正确初始化（current 可访问）', () => {
    const { result } = renderHook(() => useChatUiState({ effectiveWorkingDirectory: null }));

    expect(result.current.bottomRef.current).toBeNull();
    expect(result.current.contentColumnRef.current).toBeNull();
    expect(result.current.scrollRegionRef.current).toBeNull();
    expect(result.current.textareaRef.current).toBeNull();
    expect(result.current.pendingScrollFrameRef.current).toBeNull();
    expect(result.current.splitDragging.current).toBe(false);
    expect(result.current.splitContainerRef.current).toBeNull();
    expect(result.current.editorPaneRef.current).toBeNull();
    expect(result.current.rightOpenRef.current).toBe(false);
  });
});

describe('useChatUiState — 右侧面板写入', () => {
  it('setRightOpen 接受具体值与函数式形式，并镜像到 rightOpenRef', () => {
    const { result } = renderHook(() => useChatUiState({ effectiveWorkingDirectory: WS_A }));

    act(() => {
      result.current.setRightOpen(true);
    });
    expect(result.current.rightOpen).toBe(true);
    expect(result.current.rightOpenRef.current).toBe(true);

    act(() => {
      result.current.setRightOpen((prev) => !prev);
    });
    expect(result.current.rightOpen).toBe(false);
    expect(result.current.rightOpenRef.current).toBe(false);
  });

  it('setRightTab 接受具体值与函数式形式', () => {
    const { result } = renderHook(() => useChatUiState({ effectiveWorkingDirectory: WS_A }));

    act(() => {
      result.current.setRightTab('tools');
    });
    expect(result.current.rightTab).toBe('tools');

    act(() => {
      result.current.setRightTab((prev) => (prev === 'tools' ? 'overview' : 'tools'));
    });
    expect(result.current.rightTab).toBe('overview');
  });
});

describe('useChatUiState — workspace-keyed 字段', () => {
  it('setBrowserPreviewUrl 写入对应 workspace 桶并把 browserActive 置 true', () => {
    const { result, rerender } = renderHook(
      ({ ws }: { ws: string | null }) => useChatUiState({ effectiveWorkingDirectory: ws }),
      { initialProps: { ws: WS_A as string | null } },
    );

    act(() => {
      result.current.setBrowserPreviewUrl('http://localhost:3000');
    });
    expect(result.current.browserPreviewUrl).toBe('http://localhost:3000');
    expect(useUIStateStore.getState().browserActive).toBe(true);

    // 切到另一个 workspace 后,新桶为空,不会读到 alpha 桶的值
    rerender({ ws: WS_B });
    expect(result.current.browserPreviewUrl).toBeNull();

    // 在 beta 写入后,alpha 桶仍保留之前的值
    act(() => {
      result.current.setBrowserPreviewUrl('http://localhost:8080');
    });
    expect(result.current.browserPreviewUrl).toBe('http://localhost:8080');

    rerender({ ws: WS_A });
    expect(result.current.browserPreviewUrl).toBe('http://localhost:3000');
  });

  it('setBrowserPreviewUrl(null) 不会自动重置 browserActive', () => {
    const { result } = renderHook(() => useChatUiState({ effectiveWorkingDirectory: WS_A }));

    act(() => {
      result.current.setBrowserPreviewUrl('http://localhost:3000');
    });
    expect(useUIStateStore.getState().browserActive).toBe(true);

    act(() => {
      result.current.setBrowserPreviewUrl(null);
    });
    // 明确语义：清空 url 不会同时关浏览器面板，外部决定何时收起。
    expect(useUIStateStore.getState().browserActive).toBe(true);
    expect(result.current.browserPreviewUrl).toBeNull();
  });

  it('setEditorPaneTab 按 workspace 持久化,跨 workspace 互不影响', () => {
    const { result, rerender } = renderHook(
      ({ ws }: { ws: string | null }) => useChatUiState({ effectiveWorkingDirectory: ws }),
      { initialProps: { ws: WS_A as string | null } },
    );

    expect(result.current.editorPaneTab).toBe('code');

    act(() => {
      result.current.setEditorPaneTab('browser');
    });
    expect(result.current.editorPaneTab).toBe('browser');

    rerender({ ws: WS_B });
    // beta 桶未写入,仍是默认 'code'
    expect(result.current.editorPaneTab).toBe('code');

    rerender({ ws: WS_A });
    expect(result.current.editorPaneTab).toBe('browser');
  });

  it('quickTerminalOpen 反映对应 workspace 桶的值', () => {
    const { result, rerender } = renderHook(
      ({ ws }: { ws: string | null }) => useChatUiState({ effectiveWorkingDirectory: ws }),
      { initialProps: { ws: WS_A as string | null } },
    );

    expect(result.current.quickTerminalOpen).toBe(false);

    act(() => {
      result.current.setQuickTerminalOpenForWorkspace(WS_A, true);
    });
    expect(result.current.quickTerminalOpen).toBe(true);

    rerender({ ws: WS_B });
    expect(result.current.quickTerminalOpen).toBe(false);
  });

  it('effectiveWorkingDirectory 为 null / 空串时归入 __default__ 桶', () => {
    const { result, rerender } = renderHook(
      ({ ws }: { ws: string | null }) => useChatUiState({ effectiveWorkingDirectory: ws }),
      { initialProps: { ws: null as string | null } },
    );

    act(() => {
      result.current.setBrowserPreviewUrl('http://nullbucket.test');
    });
    expect(useUIStateStore.getState().browserPreviewUrlByWorkspace.__default__).toBe(
      'http://nullbucket.test',
    );

    rerender({ ws: '' });
    // 空串也走同一桶
    expect(result.current.browserPreviewUrl).toBe('http://nullbucket.test');
  });

  it('无工作目录的已打开会话不会读取或写入 __default__ 浏览器桶', () => {
    const sessionAScope = resolveChatUiWorkspaceScope(null, 'session-a');
    const sessionBScope = resolveChatUiWorkspaceScope(null, 'session-b');

    expect(sessionAScope).toBe('__session__:session-a');
    expect(sessionBScope).toBe('__session__:session-b');
    expect(resolveChatUiWorkspaceScope(null, null)).toBeNull();
    expect(resolveChatUiWorkspaceScope(WS_A, 'session-a')).toBe(WS_A);

    const { result, rerender } = renderHook(
      ({ uiWorkspaceScope }: { uiWorkspaceScope: string | null }) =>
        useChatUiState({
          effectiveWorkingDirectory: null,
          uiWorkspaceScope,
        }),
      { initialProps: { uiWorkspaceScope: sessionAScope } },
    );

    act(() => {
      result.current.setBrowserPreviewUrl('http://session-a.test');
      result.current.setEditorPaneTab('browser');
    });
    expect(useUIStateStore.getState().browserPreviewUrlByWorkspace.__default__).toBeUndefined();
    expect(result.current.browserPreviewUrl).toBe('http://session-a.test');
    expect(result.current.editorPaneTab).toBe('browser');

    rerender({ uiWorkspaceScope: sessionBScope });
    expect(result.current.browserPreviewUrl).toBeNull();
    expect(result.current.editorPaneTab).toBe('code');
  });
});

describe('useChatUiState — 一次性 / 信号通道', () => {
  it('bumpCompanionPanelSignal 每次调用都使 signal +1', () => {
    const { result } = renderHook(() => useChatUiState({ effectiveWorkingDirectory: WS_A }));

    expect(result.current.companionPanelSignal).toBe(0);
    act(() => result.current.bumpCompanionPanelSignal());
    expect(result.current.companionPanelSignal).toBe(1);
    act(() => {
      result.current.bumpCompanionPanelSignal();
      result.current.bumpCompanionPanelSignal();
    });
    expect(result.current.companionPanelSignal).toBe(3);
  });
});

describe('useChatUiState — sidebar 透传', () => {
  it('暴露 useChatSidebarLayout 的字段供消费方一处导入', () => {
    const { result } = renderHook(() => useChatUiState({ effectiveWorkingDirectory: WS_A }));

    expect(typeof result.current.toggleLeftSidebar).toBe('function');
    expect(typeof result.current.setLeftSidebarOpen).toBe('function');
    expect(typeof result.current.leftSidebarOpen).toBe('boolean');
    expect(typeof result.current.isNarrowViewport).toBe('boolean');
    expect(typeof result.current.shouldOverlaySidebar).toBe('boolean');
    expect(typeof result.current.sidebarWidth).toBe('string');
  });
});

describe('useUIStateStore — chatView 导航', () => {
  it('已处于 session 视图时再次 navigateToSession 不会广播更新', () => {
    useUIStateStore.setState({ chatView: 'session' });
    let updateCount = 0;
    const unsubscribe = useUIStateStore.subscribe(() => {
      updateCount += 1;
    });

    try {
      act(() => {
        useUIStateStore.getState().navigateToSession();
      });

      expect(useUIStateStore.getState().chatView).toBe('session');
      expect(updateCount).toBe(0);
    } finally {
      unsubscribe();
    }
  });
});
