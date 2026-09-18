// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import {
  DEFAULT_SESSION_SCOPE_KEY,
  DEFAULT_TEAM_SESSION_VIEW_ENTRY,
  LEGACY_LEAF_BY_PRIMARY_KEY,
  LEGACY_MIDDLE_TAB_KEY,
  LEGACY_VIEW_STATE_KEY,
  TEAM_SESSION_VIEW_STATE_STORAGE_KEY,
  readTeamSessionViewStateMap,
  type TeamSessionViewEntry,
  type TeamSessionViewStateMap,
} from './team-session-view-state-storage.js';
import {
  TeamSessionViewStateProvider,
  useTeamSessionViewStateContext,
  useTeamTabState,
} from './team-session-view-state-context.js';
import { useTeamSessionViewState } from './use-team-session-view-state.js';

/**
 * 构造完整条目：键顺序与 storage 归一化输出一致，便于做「字节级不变」断言。
 */
function makeEntry(patch: Partial<TeamSessionViewEntry>): TeamSessionViewEntry {
  return { ...DEFAULT_TEAM_SESSION_VIEW_ENTRY, updatedAt: 1_700_000_000_000, ...patch };
}

const SESSION_A_ENTRY = makeEntry({
  middleTab: 'graph',
  leafByPrimary: { overview: 'graph' },
  focusMode: true,
  officeFullscreen: true,
  editorOverlayOpen: true,
  editorPaneTab: 'browser',
  browserPreviewUrl: 'http://localhost:5173/a',
  drawerVisible: true,
  drawerTargetSessionId: 'child-a',
  selectedAgentId: 'agent-a',
  tabs: { 'graph.colorMode': 'layer', 'graph.count': '5' },
});

const SESSION_B_ENTRY = makeEntry({
  middleTab: 'taskboard',
  leafByPrimary: {},
  focusMode: false,
  officeFullscreen: false,
  editorOverlayOpen: false,
  editorPaneTab: 'code',
  browserPreviewUrl: null,
  drawerVisible: false,
  drawerTargetSessionId: 'child-b',
  selectedAgentId: 'agent-b',
  tabs: { 'graph.colorMode': 'flow' },
});

function seedMap(map: TeamSessionViewStateMap): void {
  localStorage.setItem(TEAM_SESSION_VIEW_STATE_STORAGE_KEY, JSON.stringify(map));
}

/** 读取某个作用域条目的原始 JSON 文本，用于「字节级不变」断言。 */
function readStoredEntryJson(scopeKey: string): string {
  const raw = localStorage.getItem(TEAM_SESSION_VIEW_STATE_STORAGE_KEY);
  if (raw === null) {
    throw new Error('期望 localStorage 中已有会话视图状态集合');
  }
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('期望会话视图状态集合是普通对象');
  }
  return JSON.stringify((parsed as Record<string, unknown>)[scopeKey]);
}

function renderViewState(initialSessionId: string | null) {
  return renderHook(
    (props: { readonly sessionId: string | null }) =>
      useTeamSessionViewState({ sessionId: props.sessionId }),
    { initialProps: { sessionId: initialSessionId } },
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('useTeamSessionViewState', () => {
  it('按会话水合：mount session-a 时暴露 A 的记忆', () => {
    seedMap({ 'session-a': SESSION_A_ENTRY, 'session-b': SESSION_B_ENTRY });

    const { result } = renderViewState('session-a');

    expect(result.current.scopeKey).toBe('session-a');
    expect(result.current.middleTab).toBe('graph');
    expect(result.current.focusMode).toBe(true);
    expect(result.current.showOfficeFullscreen).toBe(true);
    expect(result.current.editorOverlayOpen).toBe(true);
    expect(result.current.editorPaneTab).toBe('browser');
    expect(result.current.browserPreviewUrl).toBe('http://localhost:5173/a');
    expect(result.current.drawerVisible).toBe(true);
    // 水合时 nonce 固定为 0，保证初始化结果可预期
    expect(result.current.drawerTarget).toEqual({ sessionId: 'child-a', nonce: 0 });
    expect(result.current.selectedAgentId).toBe('agent-a');
    expect(result.current.readRememberedLeaf('overview')).toBe('graph');
  });

  it('作用域切换：所有镜像切到 session-b 的记忆', () => {
    seedMap({ 'session-a': SESSION_A_ENTRY, 'session-b': SESSION_B_ENTRY });

    const { result, rerender } = renderViewState('session-a');
    rerender({ sessionId: 'session-b' });

    expect(result.current.scopeKey).toBe('session-b');
    expect(result.current.middleTab).toBe('taskboard');
    expect(result.current.focusMode).toBe(false);
    expect(result.current.showOfficeFullscreen).toBe(false);
    expect(result.current.drawerVisible).toBe(false);
    expect(result.current.drawerTarget).toEqual({ sessionId: 'child-b', nonce: 0 });
    expect(result.current.selectedAgentId).toBe('agent-b');
  });

  it('跨作用域写入不串台：在 session-b 写入不改动 session-a 的记忆', () => {
    seedMap({ 'session-a': SESSION_A_ENTRY, 'session-b': SESSION_B_ENTRY });
    const seededSessionA = readStoredEntryJson('session-a');

    const { result, rerender } = renderViewState('session-a');
    rerender({ sessionId: 'session-b' });

    act(() => {
      result.current.setFocusMode(true);
      result.current.setDrawerTarget({ sessionId: 'child-1', nonce: 1 });
    });

    const map = readTeamSessionViewStateMap();
    expect(map['session-b']?.focusMode).toBe(true);
    expect(map['session-b']?.drawerTargetSessionId).toBe('child-1');
    expect(map['session-b']?.middleTab).toBe('taskboard');
    expect(map['session-b']?.selectedAgentId).toBe('agent-b');
    // 反串台回归断言：A 的条目必须与播种时逐字节一致
    expect(readStoredEntryJson('session-a')).toBe(seededSessionA);
  });

  it('无会话：回落默认条目且永不写盘', () => {
    const { result } = renderViewState(null);

    expect(result.current.scopeKey).toBe(DEFAULT_SESSION_SCOPE_KEY);
    expect(result.current.middleTab).toBe('conversation');
    expect(result.current.showOfficeFullscreen).toBe(false);
    expect(result.current.editorOverlayOpen).toBe(false);
    expect(result.current.drawerTarget).toBeNull();
    expect(result.current.drawerVisible).toBe(false);
    expect(result.current.selectedAgentId).toBe('');
    expect(localStorage.getItem(TEAM_SESSION_VIEW_STATE_STORAGE_KEY)).toBeNull();

    // 默认作用域内仍可操作（内存镜像生效），但绝不落盘
    act(() => {
      result.current.setFocusMode(true);
      result.current.setDrawerTarget({ sessionId: 'orphan', nonce: 2 });
      result.current.writeTabState('graph.colorMode', 'matrix');
      result.current.setMiddleTab('graph');
    });

    expect(result.current.focusMode).toBe(true);
    expect(result.current.middleTab).toBe('graph');
    expect(result.current.drawerTarget).toEqual({ sessionId: 'orphan', nonce: 2 });
    expect(localStorage.getItem(TEAM_SESSION_VIEW_STATE_STORAGE_KEY)).toBeNull();
  });

  it('新会话无存储条目时 middleTab 为 conversation', () => {
    const { result } = renderViewState('fresh-session');

    expect(result.current.middleTab).toBe('conversation');
    expect(result.current.drawerTarget).toBeNull();
    expect(result.current.selectedAgentId).toBe('');

    // 首次写入应落在该新作用域下（迁移检查不能丢掉挂载后的内存写入）
    act(() => {
      result.current.setMiddleTab('graph');
    });
    expect(readTeamSessionViewStateMap()['fresh-session']?.middleTab).toBe('graph');
  });

  it('首次打开会话时迁移旧版三个键并清除旧键', () => {
    localStorage.setItem(LEGACY_MIDDLE_TAB_KEY, 'graph');
    localStorage.setItem(
      LEGACY_VIEW_STATE_KEY,
      JSON.stringify({
        focusMode: true,
        officeFullscreen: false,
        editorOverlayOpen: true,
        editorPaneTab: 'browser',
        browserPreviewUrl: 'http://localhost:5173/legacy',
        drawerVisible: true,
        drawerTargetSessionId: 'child-legacy',
        selectedAgentId: 'agent-legacy',
      }),
    );
    localStorage.setItem(LEGACY_LEAF_BY_PRIMARY_KEY, JSON.stringify({ overview: 'health' }));

    const { result } = renderViewState('session-a');

    expect(result.current.middleTab).toBe('graph');
    expect(result.current.focusMode).toBe(true);
    expect(result.current.editorPaneTab).toBe('browser');
    expect(result.current.browserPreviewUrl).toBe('http://localhost:5173/legacy');
    expect(result.current.drawerTarget).toEqual({ sessionId: 'child-legacy', nonce: 0 });
    expect(result.current.selectedAgentId).toBe('agent-legacy');
    expect(result.current.readRememberedLeaf('overview')).toBe('health');

    expect(localStorage.getItem(LEGACY_MIDDLE_TAB_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_VIEW_STATE_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_LEAF_BY_PRIMARY_KEY)).toBeNull();
    expect(readTeamSessionViewStateMap()['session-a']?.middleTab).toBe('graph');
  });

  it('readTabState / writeTabState 按会话往返，类型不匹配时回退 fallback', () => {
    seedMap({ 'session-a': SESSION_A_ENTRY, 'session-b': SESSION_B_ENTRY });

    const { result, rerender } = renderViewState('session-a');

    expect(result.current.readTabState('graph.colorMode', 'layer')).toBe('layer');
    // 存储值是字符串 '5'，fallback 是 number → 类型不匹配，回退 fallback
    expect(result.current.readTabState('graph.count', 1)).toBe(1);
    expect(result.current.readTabState('missing.key', false)).toBe(false);

    act(() => {
      result.current.writeTabState('graph.colorMode', 'matrix');
      // 空 key 与非法值（undefined 之外的类型）都会被忽略
      result.current.writeTabState('   ', 'ignored');
    });

    expect(result.current.readTabState('graph.colorMode', 'layer')).toBe('matrix');
    expect(readTeamSessionViewStateMap()['session-a']?.tabs['graph.colorMode']).toBe('matrix');

    rerender({ sessionId: 'session-b' });
    expect(result.current.readTabState('graph.colorMode', 'layer')).toBe('flow');
  });

  it('setMiddleTab 记录叶子、rememberLeaf 不改 middleTab、readRememberedLeaf 按会话隔离', () => {
    seedMap({ 'session-a': SESSION_A_ENTRY, 'session-b': SESSION_B_ENTRY });

    const { result, rerender } = renderViewState('session-a');
    expect(result.current.middleTab).toBe('graph');
    expect(result.current.readRememberedLeaf('overview')).toBe('graph');

    act(() => {
      result.current.setMiddleTab('dashboard');
    });
    expect(result.current.middleTab).toBe('dashboard');
    expect(result.current.readRememberedLeaf('overview')).toBe('dashboard');
    expect(readTeamSessionViewStateMap()['session-a']?.leafByPrimary['overview']).toBe('dashboard');

    act(() => {
      result.current.rememberLeaf('health');
    });
    expect(result.current.middleTab).toBe('dashboard');
    expect(result.current.readRememberedLeaf('overview')).toBe('health');
    expect(readTeamSessionViewStateMap()['session-a']?.middleTab).toBe('dashboard');

    // 'office' 不属于任何主 tab：只切 middleTab，不动叶子记忆
    act(() => {
      result.current.setMiddleTab('office');
    });
    expect(result.current.middleTab).toBe('office');
    expect(result.current.readRememberedLeaf('overview')).toBe('health');

    rerender({ sessionId: 'session-b' });
    expect(result.current.readRememberedLeaf('overview')).toBeNull();
  });
});

function ProbeTabValue(): ReactNode {
  const [colorMode, setColorMode] = useTeamTabState('graph.colorMode', 'layer');
  return (
    <button type="button" onClick={() => setColorMode('layer')}>
      {colorMode}
    </button>
  );
}

function Harness({ sessionId }: { readonly sessionId: string | null }): ReactNode {
  const viewState = useTeamSessionViewState({ sessionId });
  return (
    <TeamSessionViewStateProvider value={viewState}>
      <ProbeTabValue />
    </TeamSessionViewStateProvider>
  );
}

describe('TeamSessionViewStateProvider / useTeamTabState', () => {
  it('Context：读取并按会话写回，切换作用域后重读另一会话的值', () => {
    seedMap({
      'session-a': makeEntry({ tabs: { 'graph.colorMode': 'contrast' } }),
      'session-b': makeEntry({ tabs: { 'graph.colorMode': 'flow' } }),
    });

    const { rerender } = render(<Harness sessionId="session-a" />);

    expect(screen.getByRole('button').textContent).toBe('contrast');

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button').textContent).toBe('layer');
    expect(readTeamSessionViewStateMap()['session-a']?.tabs['graph.colorMode']).toBe('layer');

    rerender(<Harness sessionId="session-b" />);
    expect(screen.getByRole('button').textContent).toBe('flow');
    expect(readTeamSessionViewStateMap()['session-b']?.tabs['graph.colorMode']).toBe('flow');
  });

  it('缺 Provider 时抛出明确错误', () => {
    expect(() => renderHook(() => useTeamSessionViewStateContext())).toThrow(
      'useTeamSessionViewStateContext 必须在 TeamSessionViewStateProvider 内使用',
    );
  });
});
