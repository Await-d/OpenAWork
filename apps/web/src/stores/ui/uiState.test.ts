import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  DEFAULT_EXPANDED_DIRS_SESSION_KEY,
  DEFAULT_TERMINAL_PANEL_SESSION_KEY,
  EMPTY_EXPANDED_DIRS,
  EMPTY_READ_IDENTITY,
  REVIEW_PANEL_WIDTH_BOUNDS,
  SIDEBAR_PANEL_WIDTH_BOUNDS,
  TERMINAL_LAYOUT_MAX_DEPTH,
  TERMINAL_LAYOUT_MAX_NODES,
  TERMINAL_PANEL_CHROME_HEIGHT,
  TERMINAL_PANEL_HEIGHT_BOUNDS,
  TERMINAL_PANEL_POSITIONS,
  TERMINAL_PANEL_STORAGE_HEIGHT_BOUNDS,
  TERMINAL_MIN_PANE_HEIGHT,
  clampReviewPanelWidth,
  clampSidebarPanelWidth,
  clampTerminalPanelHeight,
  clampTerminalPanelHeightToBounds,
  normalizeExpandedDirsSessionKey,
  resolveEffectiveTerminalPanelPosition,
  resolveTerminalPanelHeightBounds,
  resolveTerminalPanelHeightWithPaneFloor,
  terminalPanelSessionKeyFor,
  useUIStateStore,
  useWorkspaceReadIdentity,
  type WorkspaceReadIdentity,
} from './uiState.js';
import type {
  TerminalLayout,
  TerminalPaneNode,
  TerminalSplitNode,
} from '../../components/chat/terminal/layout/types.js';

function resetLayoutState(): void {
  useUIStateStore.setState({
    activeTabId: null,
    closedSessionTabIds: [],
    expandedDirsBySession: {},
    lastChatPath: null,
    reviewPanelOpened: false,
    reviewPanelWidth: REVIEW_PANEL_WIDTH_BOUNDS.default,
    sidebarPanelOpened: true,
    sidebarPanelWidth: SIDEBAR_PANEL_WIDTH_BOUNDS.default,
    tabs: [],
    teamEditorMode: 'overlay',
    teamSplitPos: 50,
    terminalLayoutBySession: {},
    terminalPanelHeight: TERMINAL_PANEL_HEIGHT_BOUNDS.default,
    terminalPanelHeightCustomized: false,
    terminalPanelMaximized: false,
    terminalPanelOpened: false,
    terminalPanelOpenedBySession: {},
    terminalPanelPosition: 'bottom',
    readIdentity: EMPTY_READ_IDENTITY,
    workbenchLayoutMode: 'fusion',
  });
}

beforeEach(resetLayoutState);
afterEach(() => {
  vi.restoreAllMocks();
  resetLayoutState();
});

describe('useUIStateStore tabs', () => {
  it('复用已打开的 session tab 并更新标题', () => {
    const firstTabId = useUIStateStore.getState().addSessionTab('s-1', '旧标题');
    const secondTabId = useUIStateStore.getState().addSessionTab('s-1', '新标题');

    const state = useUIStateStore.getState();
    expect(secondTabId).toBe(firstTabId);
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]?.title).toBe('新标题');
    expect(state.activeTabId).toBe(firstTabId);
  });

  it('关闭活跃 tab 后选择右侧相邻 tab', () => {
    const firstTabId = useUIStateStore.getState().addSessionTab('s-1', '会话一');
    const secondTabId = useUIStateStore.getState().addSessionTab('s-2', '会话二');
    useUIStateStore.getState().selectTab(firstTabId);

    const nextTab = useUIStateStore.getState().closeTab(firstTabId);

    expect(nextTab?.id).toBe(secondTabId);
    expect(useUIStateStore.getState().activeTabId).toBe(secondTabId);
  });

  it('按方向循环选择相邻 tab', () => {
    const firstTabId = useUIStateStore.getState().addDraftTab();
    const secondTabId = useUIStateStore.getState().addSessionTab('s-2', '会话二');
    useUIStateStore.getState().selectTab(secondTabId);

    const nextTab = useUIStateStore.getState().selectAdjacentTab('next');

    expect(nextTab?.id).toBe(firstTabId);
    expect(useUIStateStore.getState().activeTabId).toBe(firstTabId);
  });

  it('支持拖拽后的顺序重排', () => {
    const firstTabId = useUIStateStore.getState().addSessionTab('s-1', '会话一');
    const secondTabId = useUIStateStore.getState().addSessionTab('s-2', '会话二');

    useUIStateStore.getState().reorderTabs(0, 1);

    expect(useUIStateStore.getState().tabs.map((tab) => tab.id)).toEqual([secondTabId, firstTabId]);
  });

  it('closeTabs 批量关闭并落到最靠左被关闭位置的幸存标签', () => {
    const firstTabId = useUIStateStore.getState().addSessionTab('s-1', '会话一');
    const secondTabId = useUIStateStore.getState().addSessionTab('s-2', '会话二');
    const thirdTabId = useUIStateStore.getState().addDraftTab();
    useUIStateStore.getState().selectTab(secondTabId);

    const nextTab = useUIStateStore.getState().closeTabs([firstTabId, secondTabId]);

    expect(nextTab?.id).toBe(thirdTabId);
    expect(useUIStateStore.getState().activeTabId).toBe(thirdTabId);
    expect(useUIStateStore.getState().tabs.map((tab) => tab.id)).toEqual([thirdTabId]);
  });

  it('closeTabs 未命中任何标签时保持状态不变', () => {
    const firstTabId = useUIStateStore.getState().addSessionTab('s-1', '会话一');
    const tabsBefore = useUIStateStore.getState().tabs;

    const nextTab = useUIStateStore.getState().closeTabs(['not-exist']);

    expect(nextTab?.id).toBe(firstTabId);
    expect(useUIStateStore.getState().tabs).toBe(tabsBefore);
  });

  it('closeSessionTabs 按会话 id 关闭标签并记录待放行的会话', () => {
    const firstTabId = useUIStateStore.getState().addSessionTab('s-1', '会话一');
    const secondTabId = useUIStateStore.getState().addSessionTab('s-2', '会话二');
    useUIStateStore.getState().selectTab(firstTabId);

    const nextTab = useUIStateStore.getState().closeSessionTabs(['s-1']);

    expect(nextTab?.id).toBe(secondTabId);
    expect(useUIStateStore.getState().tabs.map((tab) => tab.id)).toEqual([secondTabId]);
    // 已删除会话在路由切走前需要被标记，避免顶部标签栏重新建回标签。
    expect(useUIStateStore.getState().closedSessionTabIds).toEqual(['s-1']);

    useUIStateStore.getState().clearClosedSessionTabIds();
    expect(useUIStateStore.getState().closedSessionTabIds).toEqual([]);
  });

  it('关闭草稿标签不会写入已删除会话标记', () => {
    const draftTabId = useUIStateStore.getState().addDraftTab();

    useUIStateStore.getState().closeTabs([draftTabId]);

    expect(useUIStateStore.getState().tabs).toEqual([]);
    expect(useUIStateStore.getState().closedSessionTabIds).toEqual([]);
  });

  it('重复「新建会话」只复用同一个草稿标签', () => {
    const firstDraftTabId = useUIStateStore.getState().addDraftTab('/ws/a');
    const secondDraftTabId = useUIStateStore.getState().addDraftTab('/ws/a');

    const state = useUIStateStore.getState();
    expect(secondDraftTabId).toBe(firstDraftTabId);
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]?.type).toBe('draft');
    expect(state.activeTabId).toBe(firstDraftTabId);
  });

  it('复用草稿标签时按最新工作区更新绑定路径', () => {
    const draftTabId = useUIStateStore.getState().addDraftTab('/ws/a');

    const nextDraftTabId = useUIStateStore.getState().addDraftTab('/ws/b');

    expect(nextDraftTabId).toBe(draftTabId);
    expect(useUIStateStore.getState().tabs).toHaveLength(1);
    expect(useUIStateStore.getState().tabs[0]?.workspacePath).toBe('/ws/b');
  });

  it('closeDraftTabs 在草稿转正后移除草稿标签并落到幸存标签', () => {
    const draftTabId = useUIStateStore.getState().addDraftTab();
    const sessionTabId = useUIStateStore.getState().addSessionTab('s-1', '会话一');

    useUIStateStore.getState().closeDraftTabs();

    const state = useUIStateStore.getState();
    expect(draftTabId).not.toBe(sessionTabId);
    expect(state.tabs.map((tab) => tab.id)).toEqual([sessionTabId]);
    expect(state.activeTabId).toBe(sessionTabId);
    expect(state.closedSessionTabIds).toEqual([]);
  });

  it('closeDraftTabs 无草稿标签时保持状态不变', () => {
    const sessionTabId = useUIStateStore.getState().addSessionTab('s-1', '会话一');
    const tabsBefore = useUIStateStore.getState().tabs;

    useUIStateStore.getState().closeDraftTabs();

    expect(useUIStateStore.getState().tabs).toBe(tabsBefore);
    expect(useUIStateStore.getState().activeTabId).toBe(sessionTabId);
  });
});

describe('sidebar panel width', () => {
  it('把侧栏面板宽度夹在持久化范围内', () => {
    expect(clampSidebarPanelWidth(10)).toBe(SIDEBAR_PANEL_WIDTH_BOUNDS.min);
    expect(clampSidebarPanelWidth(9999)).toBe(SIDEBAR_PANEL_WIDTH_BOUNDS.max);
    expect(clampSidebarPanelWidth(Number.NaN)).toBe(SIDEBAR_PANEL_WIDTH_BOUNDS.default);
  });
});

describe('chat panels state', () => {
  it('把审阅面板宽度和终端面板高度夹在持久化范围内', () => {
    expect(clampReviewPanelWidth(10)).toBe(REVIEW_PANEL_WIDTH_BOUNDS.min);
    expect(clampReviewPanelWidth(9999)).toBe(REVIEW_PANEL_WIDTH_BOUNDS.max);
    expect(clampReviewPanelWidth(Number.NaN)).toBe(REVIEW_PANEL_WIDTH_BOUNDS.default);

    expect(clampTerminalPanelHeight(10)).toBe(TERMINAL_PANEL_HEIGHT_BOUNDS.min);
    expect(clampTerminalPanelHeight(9999)).toBe(TERMINAL_PANEL_HEIGHT_BOUNDS.max);
    expect(clampTerminalPanelHeight(Number.NaN)).toBe(TERMINAL_PANEL_HEIGHT_BOUNDS.default);
  });

  it('持久化审阅与终端面板的开关状态', () => {
    useUIStateStore.getState().toggleReviewPanelOpened();
    useUIStateStore.getState().setTerminalPanelOpened(true);

    expect(useUIStateStore.getState().reviewPanelOpened).toBe(true);
    expect(useUIStateStore.getState().terminalPanelOpened).toBe(true);
  });
});

describe('reviewPanelOpened 刷新后保持（持久化偏好）', () => {
  it('partialize 保留 reviewPanelOpened，不再被排除出存储', () => {
    const partialize = useUIStateStore.persist.getOptions().partialize;
    if (!partialize) {
      throw new Error('useUIStateStore.persist 未配置 partialize');
    }

    const partial = partialize({
      ...useUIStateStore.getState(),
      reviewPanelOpened: true,
    }) as { reviewPanelOpened?: boolean };

    expect(partial.reviewPanelOpened).toBe(true);
  });

  it('merge 尊重存储值；缺省与非布尔脏数据回落 false', () => {
    const merge = useUIStateStore.persist.getOptions().merge;
    if (!merge) {
      throw new Error('useUIStateStore.persist 未配置 merge');
    }
    // 水合期 currentState 取 store 默认值（reviewPanelOpened: false）。
    const defaultCurrent = { ...useUIStateStore.getState(), reviewPanelOpened: false };

    // 存储中的展开态必须被保留（本次修复的核心：不再被水合强制关闭）。
    expect(merge({ reviewPanelOpened: true }, defaultCurrent).reviewPanelOpened).toBe(true);
    // 存储中的收起态同样保留，覆盖 currentState 的 true。
    expect(
      merge({ reviewPanelOpened: false }, { ...defaultCurrent, reviewPanelOpened: true })
        .reviewPanelOpened,
    ).toBe(false);
    // 旧版本未持久化该键 → 保留 currentState 的默认 false。
    expect(merge({}, defaultCurrent).reviewPanelOpened).toBe(false);
    // 手改出的非布尔值不穿到渲染期。
    expect(
      merge({ reviewPanelOpened: 'yes' }, { ...defaultCurrent, reviewPanelOpened: true })
        .reviewPanelOpened,
    ).toBe(false);
  });

  it('migrate 对 v20 之前的历史快照强制关闭，尾部兜底非布尔值', () => {
    // v20 起该字段才停止持久化，因此 v19 及更早存储里可能残留 true，需清掉。
    expect(runPersistMigration({ reviewPanelOpened: true }, 19).reviewPanelOpened).toBe(false);
    expect(runPersistMigration({ reviewPanelOpened: 'yes' }, 26).reviewPanelOpened).toBe(false);
    expect(runPersistMigration({}, 26).reviewPanelOpened).toBe(false);
  });
});

describe('sidePanelActiveTab 载入期兜底（统一面板 tab）', () => {
  it('merge 保留已知 tab（含新增的 code / preview），未知值回落 review', () => {
    const merge = useUIStateStore.persist.getOptions().merge;
    if (!merge) {
      throw new Error('useUIStateStore.persist 未配置 merge');
    }
    const defaultCurrent = { ...useUIStateStore.getState(), sidePanelActiveTab: 'review' as const };

    for (const tab of ['review', 'code', 'preview', 'context', 'files', 'browser'] as const) {
      expect(merge({ sidePanelActiveTab: tab }, defaultCurrent).sidePanelActiveTab).toBe(tab);
    }

    expect(merge({ sidePanelActiveTab: 'legacy-unknown' }, defaultCurrent).sidePanelActiveTab).toBe(
      'review',
    );
    expect(merge({ sidePanelActiveTab: 42 }, defaultCurrent).sidePanelActiveTab).toBe('review');
    expect(merge({}, defaultCurrent).sidePanelActiveTab).toBe('review');
  });
});

describe('sidePanelWorkspaceTab 已移除（一级 tab 扁平化）', () => {
  it('store 不再暴露该字段，旧持久化残留值在 merge 被丢弃且无害', () => {
    const state = useUIStateStore.getState();
    expect('sidePanelWorkspaceTab' in state).toBe(false);
    expect('setSidePanelWorkspaceTab' in state).toBe(false);

    const merge = useUIStateStore.persist.getOptions().merge;
    if (!merge) {
      throw new Error('useUIStateStore.persist 未配置 merge');
    }
    const merged = merge({ sidePanelWorkspaceTab: 'browser' }, state);

    expect('sidePanelWorkspaceTab' in merged).toBe(false);
    expect(merged.sidePanelActiveTab).toBe(state.sidePanelActiveTab);
  });
});

describe('terminal panel height bounds（视口相对）', () => {
  it.each([
    [768, 553, 269],
    [800, 576, 280],
    [1080, 778, 378],
    [1440, 900, 504],
  ])('视口 %ipx → min 120 / max %i / default %i', (viewportHeight, max, defaultHeight) => {
    const bounds = resolveTerminalPanelHeightBounds(viewportHeight);

    expect(bounds).toEqual({
      min: TERMINAL_PANEL_HEIGHT_BOUNDS.min,
      max,
      default: defaultHeight,
    });
    expect(bounds.default).toBeLessThanOrEqual(bounds.max);
    expect(bounds.max).toBeGreaterThanOrEqual(bounds.min + 120);
  });

  it('极矮视口仍保证 max ≥ min + 120，default 不低于 min + 40', () => {
    const bounds = resolveTerminalPanelHeightBounds(200);

    expect(bounds.max).toBe(TERMINAL_PANEL_HEIGHT_BOUNDS.min + 120);
    expect(bounds.default).toBe(TERMINAL_PANEL_HEIGHT_BOUNDS.min + 40);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -100])(
    '视口为 %s 时回落到静态 bounds',
    (viewportHeight) => {
      expect(resolveTerminalPanelHeightBounds(viewportHeight)).toEqual({
        ...TERMINAL_PANEL_HEIGHT_BOUNDS,
      });
    },
  );
});

describe('clampTerminalPanelHeightToBounds', () => {
  const bounds = resolveTerminalPanelHeightBounds(800);

  it('下越界抬到 min、上越界压到 max', () => {
    expect(clampTerminalPanelHeightToBounds(10, bounds)).toBe(bounds.min);
    expect(clampTerminalPanelHeightToBounds(9999, bounds)).toBe(bounds.max);
  });

  it('NaN 回落到 bounds.default', () => {
    expect(clampTerminalPanelHeightToBounds(Number.NaN, bounds)).toBe(bounds.default);
  });

  it('边界值原样保留，中间值四舍五入', () => {
    expect(clampTerminalPanelHeightToBounds(bounds.min, bounds)).toBe(bounds.min);
    expect(clampTerminalPanelHeightToBounds(bounds.max, bounds)).toBe(bounds.max);
    expect(clampTerminalPanelHeightToBounds(300.6, bounds)).toBe(301);
  });
});

describe('分屏下限抬升（resolveTerminalPanelHeightWithPaneFloor）', () => {
  const bounds = resolveTerminalPanelHeightBounds(800);

  it('单 pane 不抬升', () => {
    expect(resolveTerminalPanelHeightWithPaneFloor(200, 1, bounds)).toBe(200);
  });

  it('2 pane 抬到 chrome + 2 × 单 pane 下限', () => {
    expect(resolveTerminalPanelHeightWithPaneFloor(200, 2, bounds)).toBe(
      TERMINAL_PANEL_CHROME_HEIGHT + 2 * TERMINAL_MIN_PANE_HEIGHT,
    );
  });

  it('4 pane 抬到 chrome + 4 × 单 pane 下限', () => {
    expect(resolveTerminalPanelHeightWithPaneFloor(200, 4, bounds)).toBe(
      TERMINAL_PANEL_CHROME_HEIGHT + 4 * TERMINAL_MIN_PANE_HEIGHT,
    );
  });

  it('已超过所需高度时不动', () => {
    expect(resolveTerminalPanelHeightWithPaneFloor(400, 2, bounds)).toBe(400);
  });

  it('抬升结果仍受 bounds.max 约束', () => {
    const shortBounds = resolveTerminalPanelHeightBounds(500);
    const floor = TERMINAL_PANEL_CHROME_HEIGHT + 4 * TERMINAL_MIN_PANE_HEIGHT;

    expect(floor).toBeGreaterThan(shortBounds.max);
    expect(resolveTerminalPanelHeightWithPaneFloor(200, 4, shortBounds)).toBe(shortBounds.max);
  });

  it('paneCount 非有限数按单 pane 处理', () => {
    expect(resolveTerminalPanelHeightWithPaneFloor(200, Number.NaN, bounds)).toBe(200);
  });
});

describe('terminalPanelHeight 自定义标记', () => {
  it('默认为未自定义', () => {
    expect(useUIStateStore.getState().terminalPanelHeightCustomized).toBe(false);
  });

  it('setTerminalPanelHeight 写值并置自定义标记', () => {
    useUIStateStore.getState().setTerminalPanelHeight(240);

    const state = useUIStateStore.getState();
    expect(state.terminalPanelHeight).toBe(240);
    expect(state.terminalPanelHeightCustomized).toBe(true);
  });

  it('写入值按持久化域 bounds 钳制（上限放宽到绝对上限）', () => {
    useUIStateStore.getState().setTerminalPanelHeight(9999);
    expect(useUIStateStore.getState().terminalPanelHeight).toBe(
      TERMINAL_PANEL_STORAGE_HEIGHT_BOUNDS.max,
    );

    useUIStateStore.getState().setTerminalPanelHeight(10);
    expect(useUIStateStore.getState().terminalPanelHeight).toBe(
      TERMINAL_PANEL_STORAGE_HEIGHT_BOUNDS.min,
    );
  });
});

describe('workbench layout state', () => {
  it('保留 classic/fusion 切换和 Team 编辑器布局偏好', () => {
    useUIStateStore.getState().setWorkbenchLayoutMode('classic');
    useUIStateStore.getState().setTeamEditorMode('split');
    useUIStateStore.getState().setTeamSplitPos(90);

    expect(useUIStateStore.getState().workbenchLayoutMode).toBe('classic');
    expect(useUIStateStore.getState().teamEditorMode).toBe('split');
    expect(useUIStateStore.getState().teamSplitPos).toBe(80);

    useUIStateStore.getState().setWorkbenchLayoutMode('fusion');
    useUIStateStore.getState().setTeamSplitPos(10);

    expect(useUIStateStore.getState().workbenchLayoutMode).toBe('fusion');
    expect(useUIStateStore.getState().teamSplitPos).toBe(20);
  });
});

type PersistedSnapshot = Record<string, unknown>;

/**
 * persist 中间件只在版本不一致时才调用 migrate；这里直接取出迁移函数执行，
 * 避免依赖 rehydrate 的异步时序与节流存储的待写入缓冲。
 */
function runPersistMigration(
  snapshot: PersistedSnapshot,
  version: number,
): Record<string, unknown> {
  const migrate = useUIStateStore.persist.getOptions().migrate;
  if (!migrate) {
    throw new Error('useUIStateStore.persist 未配置 migrate');
  }

  const migrated: unknown = migrate(snapshot, version);
  if (typeof migrated !== 'object' || migrated === null) {
    throw new Error('迁移结果不是普通对象');
  }
  return migrated as Record<string, unknown>;
}

const DIRTY_LEGACY_EXPANDED_DIRS: ReadonlyArray<[label: string, value: unknown]> = [
  ['空数组', []],
  ['缺失', undefined],
  ['非字符串数组', [1, 2]],
  ['字符串', 'x'],
  ['null', null],
];

const NON_OBJECT_EXPANDED_DIRS_BY_SESSION: ReadonlyArray<[label: string, value: unknown]> = [
  ['null', null],
  ['数组', ['/a']],
  ['数字', 42],
  ['缺失', undefined],
];

const NULLISH_SESSION_KEYS: ReadonlyArray<[label: string, key: string | null | undefined]> = [
  ['undefined', undefined],
  ['null', null],
  ['空字符串', ''],
  ['纯空白', '   '],
];

describe('expandedDirs v22 → v23 迁移', () => {
  it('把旧的全局展开目录归入 __default__ 桶并删除旧字段', () => {
    const migrated = runPersistMigration({ expandedDirs: ['/a/src', '/b'] }, 22);

    expect(Reflect.has(migrated, 'expandedDirs')).toBe(false);
    expect(migrated.expandedDirsBySession).toEqual({
      [DEFAULT_EXPANDED_DIRS_SESSION_KEY]: ['/a/src', '/b'],
    });
  });

  it.each(DIRTY_LEGACY_EXPANDED_DIRS)(
    '旧 expandedDirs 为 %s 时迁移为空桶且不抛错',
    (_label, value) => {
      const snapshot: PersistedSnapshot = {};
      if (value !== undefined) {
        snapshot.expandedDirs = value;
      }

      const migrated = runPersistMigration(snapshot, 22);

      expect(Reflect.has(migrated, 'expandedDirs')).toBe(false);
      expect(migrated.expandedDirsBySession).toEqual({});
    },
  );
});

describe('expandedDirsBySession 迁移守卫', () => {
  it.each(NON_OBJECT_EXPANDED_DIRS_BY_SESSION)(
    'expandedDirsBySession 为 %s 时归一为空桶',
    (_label, value) => {
      const snapshot: PersistedSnapshot = {};
      if (value !== undefined) {
        snapshot.expandedDirsBySession = value;
      }

      expect(runPersistMigration(snapshot, 23).expandedDirsBySession).toEqual({});
    },
  );

  it('丢弃非法桶并剔除空数组桶，只保留非空字符串数组', () => {
    const migrated = runPersistMigration(
      {
        expandedDirsBySession: {
          'session-a': ['/a/src'],
          'session-b': [],
          'session-c': [1, 2],
          'session-d': 'x',
          'session-e': null,
        },
      },
      23,
    );

    expect(migrated.expandedDirsBySession).toEqual({ 'session-a': ['/a/src'] });
  });
});

describe('setExpandedDirsForSession', () => {
  it('写入非空数组并在写入空数组时删除该桶', () => {
    useUIStateStore.getState().setExpandedDirsForSession('session-a', ['/a/src']);
    expect(useUIStateStore.getState().expandedDirsBySession).toEqual({
      'session-a': ['/a/src'],
    });

    useUIStateStore.getState().setExpandedDirsForSession('session-a', []);
    expect('session-a' in useUIStateStore.getState().expandedDirsBySession).toBe(false);
    expect(useUIStateStore.getState().expandedDirsBySession).toEqual({});
  });

  it.each(NULLISH_SESSION_KEYS)('sessionKey 为 %s 时落到 __default__ 桶', (_label, key) => {
    useUIStateStore.getState().setExpandedDirsForSession(key, ['/a']);

    expect(useUIStateStore.getState().expandedDirsBySession).toEqual({
      [DEFAULT_EXPANDED_DIRS_SESSION_KEY]: ['/a'],
    });
  });

  it('trim sessionKey 后再写入', () => {
    useUIStateStore.getState().setExpandedDirsForSession('  abc  ', ['/a']);

    expect(Object.keys(useUIStateStore.getState().expandedDirsBySession)).toEqual(['abc']);
  });
});

describe('normalizeExpandedDirsSessionKey', () => {
  it.each(NULLISH_SESSION_KEYS)('%s → __default__', (_label, key) => {
    expect(normalizeExpandedDirsSessionKey(key)).toBe(DEFAULT_EXPANDED_DIRS_SESSION_KEY);
  });

  it('去空格后返回会话 id', () => {
    expect(normalizeExpandedDirsSessionKey(' abc ')).toBe('abc');
  });
});

describe('EMPTY_EXPANDED_DIRS', () => {
  it('selector 兜底返回同一引用，避免每次渲染生成新数组', () => {
    const readExpandedDirs = (sessionKey: string): readonly string[] =>
      useUIStateStore.getState().expandedDirsBySession[sessionKey] ?? EMPTY_EXPANDED_DIRS;

    expect(readExpandedDirs('session-a')).toBe(EMPTY_EXPANDED_DIRS);
    expect(readExpandedDirs('session-a')).toBe(readExpandedDirs('session-b'));
    expect(EMPTY_EXPANDED_DIRS).toHaveLength(0);
  });
});

describe('terminalPanelSessionKeyFor', () => {
  it('无 chat path 时回退到 __default__ 桶键', () => {
    expect(terminalPanelSessionKeyFor(null)).toBe(DEFAULT_TERMINAL_PANEL_SESSION_KEY);
    expect(terminalPanelSessionKeyFor('   ')).toBe(DEFAULT_TERMINAL_PANEL_SESSION_KEY);
  });

  it('直接用规范化后的完整 chat path 作键', () => {
    expect(terminalPanelSessionKeyFor('/chat/session-a')).toBe('/chat/session-a');
    expect(terminalPanelSessionKeyFor('/chat')).toBe('/chat');
  });
});

describe('terminalPanelOpened 按会话隔离', () => {
  it('会话 A 展开 → 切到 B 收起 → 切回 A 仍展开', () => {
    const store = useUIStateStore.getState();
    store.setLastChatPath('/chat/session-a');
    store.setTerminalPanelOpened(true);
    expect(useUIStateStore.getState().terminalPanelOpened).toBe(true);

    store.setLastChatPath('/chat/session-b');
    expect(useUIStateStore.getState().terminalPanelOpened).toBe(false);

    store.setLastChatPath('/chat/session-a');
    expect(useUIStateStore.getState().terminalPanelOpened).toBe(true);
  });

  it('setTerminalPanelOpened 只写当前会话桶，不污染其他会话', () => {
    const store = useUIStateStore.getState();
    store.setLastChatPath('/chat/session-a');
    store.setTerminalPanelOpened(true);
    store.setLastChatPath('/chat/session-b');
    store.setTerminalPanelOpened(false);

    const state = useUIStateStore.getState();
    expect(state.terminalPanelOpenedBySession['/chat/session-a']).toBe(true);
    expect(state.terminalPanelOpenedBySession['/chat/session-b']).toBe(false);
    expect(state.terminalPanelOpened).toBe(false);
  });

  it('toggleTerminalPanelOpened 对当前会话取反并同步镜像', () => {
    const store = useUIStateStore.getState();
    store.setLastChatPath('/chat/session-a');

    store.toggleTerminalPanelOpened();
    expect(useUIStateStore.getState().terminalPanelOpened).toBe(true);
    expect(useUIStateStore.getState().terminalPanelOpenedBySession['/chat/session-a']).toBe(true);

    store.toggleTerminalPanelOpened();
    expect(useUIStateStore.getState().terminalPanelOpened).toBe(false);
    expect(useUIStateStore.getState().terminalPanelOpenedBySession['/chat/session-a']).toBe(false);
  });

  it('同一会话内重复 setLastChatPath 不重置镜像', () => {
    const store = useUIStateStore.getState();
    store.setLastChatPath('/chat/session-a');
    store.setTerminalPanelOpened(true);

    store.setLastChatPath('/chat/session-a');
    store.setLastChatPath('/chat/session-a  ');

    expect(useUIStateStore.getState().terminalPanelOpened).toBe(true);
    expect(useUIStateStore.getState().terminalPanelOpenedBySession['/chat/session-a']).toBe(true);
  });

  it('无 chat path 时归入 __default__ 桶', () => {
    const store = useUIStateStore.getState();
    store.setTerminalPanelOpened(true);

    expect(
      useUIStateStore.getState().terminalPanelOpenedBySession[DEFAULT_TERMINAL_PANEL_SESSION_KEY],
    ).toBe(true);
    expect(useUIStateStore.getState().terminalPanelOpened).toBe(true);
  });
});

describe('terminalPanelOpened v23 → v24 迁移', () => {
  it('把旧的全局打开状态归入 __default__ 桶并保留镜像字段', () => {
    const migrated = runPersistMigration({ terminalPanelOpened: true }, 23);

    expect(migrated.terminalPanelOpened).toBe(true);
    expect(migrated.terminalPanelOpenedBySession).toEqual({
      [DEFAULT_TERMINAL_PANEL_SESSION_KEY]: true,
    });
  });

  it('旧值为 false / 非布尔时迁移为空桶', () => {
    expect(
      runPersistMigration({ terminalPanelOpened: false }, 23).terminalPanelOpenedBySession,
    ).toEqual({});
    expect(
      runPersistMigration({ terminalPanelOpened: 'yes' }, 23).terminalPanelOpenedBySession,
    ).toEqual({});
    expect(runPersistMigration({}, 23).terminalPanelOpenedBySession).toEqual({});
  });
});

const NON_OBJECT_TERMINAL_PANEL_BUCKETS: ReadonlyArray<[label: string, value: unknown]> = [
  ['null', null],
  ['数组', ['/chat/session-a']],
  ['数字', 42],
  ['缺失', undefined],
];

describe('terminalPanelOpenedBySession 迁移守卫', () => {
  it.each(NON_OBJECT_TERMINAL_PANEL_BUCKETS)(
    'terminalPanelOpenedBySession 为 %s 时归一为空桶',
    (_label, value) => {
      const snapshot: PersistedSnapshot = {};
      if (value !== undefined) {
        snapshot.terminalPanelOpenedBySession = value;
      }

      expect(runPersistMigration(snapshot, 24).terminalPanelOpenedBySession).toEqual({});
    },
  );

  it('丢弃非布尔桶值，保留布尔桶（含 false）', () => {
    const migrated = runPersistMigration(
      {
        terminalPanelOpenedBySession: {
          '/chat/session-a': true,
          '/chat/session-b': false,
          '/chat/session-c': 'yes',
          '/chat/session-d': null,
          '/chat/session-e': 1,
        },
      },
      24,
    );

    expect(migrated.terminalPanelOpenedBySession).toEqual({
      '/chat/session-a': true,
      '/chat/session-b': false,
    });
  });
});

const VALID_PANE: TerminalPaneNode = {
  kind: 'pane',
  id: 'p1',
  terminalIds: ['t1'],
  activeTerminalId: 't1',
};

const VALID_SPLIT: TerminalSplitNode = {
  kind: 'split',
  id: 's1',
  direction: 'row',
  ratio: 0.5,
  children: [
    { kind: 'pane', id: 'p1', terminalIds: ['t1'], activeTerminalId: 't1' },
    { kind: 'pane', id: 'p2', terminalIds: ['t2'], activeTerminalId: 't2' },
  ],
};

/** 左倾链：n 个 split + n+1 个 pane，最深节点位于第 n+1 层。 */
function chainLayout(n: number): unknown {
  let node: unknown = {
    kind: 'pane',
    id: 'chain-leaf',
    terminalIds: ['chain-leaf'],
    activeTerminalId: 'chain-leaf',
  };
  for (let index = 0; index < n; index += 1) {
    node = {
      kind: 'split',
      id: `chain-split-${index}`,
      direction: 'row',
      ratio: 0.5,
      children: [
        node,
        {
          kind: 'pane',
          id: `chain-pane-${index}`,
          terminalIds: [`chain-t-${index}`],
          activeTerminalId: `chain-t-${index}`,
        },
      ],
    };
  }
  return node;
}

/** 满二叉树：depth 层 → (2^depth - 1) 个 split + 2^depth 个 pane。 */
function fullBinaryLayout(depth: number): unknown {
  if (depth === 0) {
    return { kind: 'pane', id: 'leaf', terminalIds: ['leaf'], activeTerminalId: 'leaf' };
  }
  return {
    kind: 'split',
    id: `binary-${depth}`,
    direction: 'column',
    ratio: 0.5,
    children: [fullBinaryLayout(depth - 1), fullBinaryLayout(depth - 1)],
  };
}

describe('terminalLayoutBySession v24 → v25 迁移', () => {
  it('persist 版本已提升到 26', () => {
    expect(useUIStateStore.persist.getOptions().version).toBe(26);
  });

  it('v24 快照迁移得到空桶（分屏能力本轮才引入，无历史值可迁移）', () => {
    const migrated = runPersistMigration({ terminalPanelOpened: true }, 24);

    expect(migrated.terminalLayoutBySession).toEqual({});
  });
});

describe('terminalPanelHeightCustomized v25 → v26 迁移', () => {
  it('老数据无自定义标记 → false（老用户也能拿到视口默认高）', () => {
    const migrated = runPersistMigration({ terminalPanelHeight: 240 }, 25);

    expect(migrated.terminalPanelHeightCustomized).toBe(false);
    expect(migrated.terminalPanelHeight).toBe(240);
  });

  it('老数据高度越界 → 钳到持久化域上限', () => {
    const migrated = runPersistMigration({ terminalPanelHeight: 9999 }, 25);

    expect(migrated.terminalPanelHeight).toBe(TERMINAL_PANEL_STORAGE_HEIGHT_BOUNDS.max);
    expect(migrated.terminalPanelHeightCustomized).toBe(false);
  });

  it('同版本脏数据（非布尔标记 / 越界高度）在载入期被归一', () => {
    const migrated = runPersistMigration(
      { terminalPanelHeight: 1_000_000, terminalPanelHeightCustomized: 'yes' },
      26,
    );

    expect(migrated.terminalPanelHeight).toBe(TERMINAL_PANEL_STORAGE_HEIGHT_BOUNDS.max);
    expect(migrated.terminalPanelHeightCustomized).toBe(false);
  });
});

const INVALID_LAYOUT_VALUES: ReadonlyArray<[label: string, value: unknown]> = [
  ['非对象（数字）', 42],
  ['数组', [VALID_PANE]],
  ['字符串', 'pane'],
  ['未知 kind', { kind: 'grid', id: 'g' }],
  ['ratio 为 NaN', { ...VALID_SPLIT, ratio: Number.NaN }],
  ['ratio 为 Infinity', { ...VALID_SPLIT, ratio: Number.POSITIVE_INFINITY }],
  ['ratio 非 number', { ...VALID_SPLIT, ratio: '0.5' }],
  ['children 含 null 元素', { ...VALID_SPLIT, children: [VALID_PANE, null] }],
  ['children 只有一个', { ...VALID_SPLIT, children: [VALID_PANE] }],
  ['children 不是数组', { ...VALID_SPLIT, children: VALID_PANE }],
  ['direction 非法', { ...VALID_SPLIT, direction: 'diagonal' }],
  [
    'pane 空 terminalIds（禁止空 pane）',
    { kind: 'pane', id: 'p', terminalIds: [], activeTerminalId: 'x' },
  ],
  [
    'pane active 不在 terminalIds',
    { kind: 'pane', id: 'p', terminalIds: ['a'], activeTerminalId: 'b' },
  ],
  [
    'pane terminalIds 含非字符串',
    { kind: 'pane', id: 'p', terminalIds: ['a', 1], activeTerminalId: 'a' },
  ],
];

describe('terminalLayoutBySession 迁移守卫（结构校验）', () => {
  it.each(INVALID_LAYOUT_VALUES)('%s → 丢弃该桶', (_label, value) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const migrated = runPersistMigration(
      { terminalLayoutBySession: { '/chat/session-a': value } },
      25,
    );

    expect(migrated.terminalLayoutBySession).toEqual({});
  });

  it('保留合法树与 null，丢弃非法桶，每个非法桶 warn 一次', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const migrated = runPersistMigration(
      {
        terminalLayoutBySession: {
          '/chat/valid-split': VALID_SPLIT,
          '/chat/valid-pane': VALID_PANE,
          '/chat/no-split': null,
          '/chat/dirty-ratio': { ...VALID_SPLIT, ratio: Number.NaN },
          '/chat/dirty-shape': 42,
        },
      },
      25,
    );

    expect(migrated.terminalLayoutBySession).toEqual({
      '/chat/valid-split': VALID_SPLIT,
      '/chat/valid-pane': VALID_PANE,
      '/chat/no-split': null,
    });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['null', null],
    ['数组', ['/chat/session-a']],
    ['数字', 42],
    ['字符串', 'x'],
    ['缺失', undefined],
  ] as ReadonlyArray<[string, unknown]>)('整桶为 %s 时归一为空桶', (_label, value) => {
    const snapshot: PersistedSnapshot = {};
    if (value !== undefined) {
      snapshot.terminalLayoutBySession = value;
    }

    expect(runPersistMigration(snapshot, 25).terminalLayoutBySession).toEqual({});
  });
});

describe('terminalLayoutBySession 三道硬限制（防深递归炸弹）', () => {
  it('限制值就是 32 / 64', () => {
    expect(TERMINAL_LAYOUT_MAX_DEPTH).toBe(32);
    expect(TERMINAL_LAYOUT_MAX_NODES).toBe(64);
  });

  it('硬限制一/二：31 层链（63 节点，深度 32）在预算内 → 保留', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const migrated = runPersistMigration(
      { terminalLayoutBySession: { '/chat/session-a': chainLayout(31) } },
      25,
    );

    expect(migrated.terminalLayoutBySession).toHaveProperty('/chat/session-a');
  });

  it('硬限制一/二：40 层链（81 节点，深度 41）超限 → 丢弃且不抛错', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const migrated = runPersistMigration(
      { terminalLayoutBySession: { '/chat/session-a': chainLayout(40) } },
      25,
    );

    expect(migrated.terminalLayoutBySession).toEqual({});
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('硬限制二：满二叉树 depth 5（63 节点）保留，depth 6（127 节点）超节点预算 → 丢弃', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const shallow = runPersistMigration(
      { terminalLayoutBySession: { '/chat/shallow': fullBinaryLayout(5) } },
      25,
    );
    const tooManyNodes = runPersistMigration(
      { terminalLayoutBySession: { '/chat/deep': fullBinaryLayout(6) } },
      25,
    );

    expect(shallow.terminalLayoutBySession).toHaveProperty('/chat/shallow');
    expect(tooManyNodes.terminalLayoutBySession).toEqual({});
  });

  it('硬限制三：ratio 为 NaN / Infinity / 非 number 的每个桶都被丢弃', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const migrated = runPersistMigration(
      {
        terminalLayoutBySession: {
          '/chat/nan': { ...VALID_SPLIT, ratio: Number.NaN },
          '/chat/inf': { ...VALID_SPLIT, ratio: Number.POSITIVE_INFINITY },
          '/chat/str': { ...VALID_SPLIT, ratio: '0.5' },
        },
      },
      25,
    );

    expect(migrated.terminalLayoutBySession).toEqual({});
    expect(warn).toHaveBeenCalledTimes(3);
  });
});

describe('setTerminalLayoutForSession', () => {
  it('写入合法树；写 null 时删除该桶', () => {
    const store = useUIStateStore.getState();
    store.setTerminalLayoutForSession('/chat/session-a', VALID_SPLIT);

    expect(useUIStateStore.getState().terminalLayoutBySession).toEqual({
      '/chat/session-a': VALID_SPLIT,
    });

    store.setTerminalLayoutForSession('/chat/session-a', null);
    expect(useUIStateStore.getState().terminalLayoutBySession).toEqual({});
    expect('/chat/session-a' in useUIStateStore.getState().terminalLayoutBySession).toBe(false);
  });

  it('sessionKey 经 terminalPanelSessionKeyFor 规范化（trim / 空值落 __default__）', () => {
    const store = useUIStateStore.getState();
    store.setTerminalLayoutForSession('  /chat/session-a  ', VALID_PANE);
    expect(Object.keys(useUIStateStore.getState().terminalLayoutBySession)).toEqual([
      '/chat/session-a',
    ]);

    store.setTerminalLayoutForSession('', VALID_PANE);
    expect(
      useUIStateStore.getState().terminalLayoutBySession[DEFAULT_TERMINAL_PANEL_SESSION_KEY],
    ).toEqual(VALID_PANE);
  });

  it('只写目标会话桶，不影响其他会话', () => {
    const store = useUIStateStore.getState();
    store.setTerminalLayoutForSession('/chat/session-a', VALID_PANE);
    store.setTerminalLayoutForSession('/chat/session-b', VALID_SPLIT);

    const buckets = useUIStateStore.getState().terminalLayoutBySession;
    expect(buckets['/chat/session-a']).toEqual(VALID_PANE);
    expect(buckets['/chat/session-b']).toEqual(VALID_SPLIT);

    store.setTerminalLayoutForSession('/chat/session-a', null);
    expect(useUIStateStore.getState().terminalLayoutBySession['/chat/session-b']).toEqual(
      VALID_SPLIT,
    );
  });
});

describe('terminalLayoutBySession 持久化装配（partialize / merge 核查）', () => {
  it('partialize 经 rest 解构自动带上新字段', () => {
    const partialize = useUIStateStore.persist.getOptions().partialize;
    if (!partialize) {
      throw new Error('useUIStateStore.persist 未配置 partialize');
    }

    const partial = partialize({
      ...useUIStateStore.getState(),
      terminalLayoutBySession: { '/chat/session-a': VALID_SPLIT },
    }) as { terminalLayoutBySession?: Record<string, TerminalLayout | null> };

    expect(partial.terminalLayoutBySession).toEqual({ '/chat/session-a': VALID_SPLIT });
  });

  it('merge 的覆盖方向是 persisted 盖 currentState —— 空桶不会冲掉已持久化布局', () => {
    const merge = useUIStateStore.persist.getOptions().merge;
    if (!merge) {
      throw new Error('useUIStateStore.persist 未配置 merge');
    }

    const merged = merge(
      { terminalLayoutBySession: { '/chat/session-a': VALID_SPLIT } },
      { ...useUIStateStore.getState(), terminalLayoutBySession: {} },
    );

    expect(merged.terminalLayoutBySession).toEqual({ '/chat/session-a': VALID_SPLIT });
  });

  it('merge 对同版本脏数据兜底结构校验（不经 migrate 也不放行）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const merge = useUIStateStore.persist.getOptions().merge;
    if (!merge) {
      throw new Error('useUIStateStore.persist 未配置 merge');
    }

    const merged = merge(
      {
        terminalLayoutBySession: {
          '/chat/good': VALID_PANE,
          '/chat/bad': { kind: 'pane', id: 'p', terminalIds: [], activeTerminalId: 'x' },
        },
      },
      { ...useUIStateStore.getState(), terminalLayoutBySession: {} },
    );

    expect(merged.terminalLayoutBySession).toEqual({ '/chat/good': VALID_PANE });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('terminalPanelMaximized 瞬态契约（不落盘 + 启动强制 false）', () => {
  it('默认 false，setter / toggle 只改瞬态字段', () => {
    expect(useUIStateStore.getState().terminalPanelMaximized).toBe(false);

    useUIStateStore.getState().setTerminalPanelMaximized(true);
    expect(useUIStateStore.getState().terminalPanelMaximized).toBe(true);

    useUIStateStore.getState().toggleTerminalPanelMaximized();
    expect(useUIStateStore.getState().terminalPanelMaximized).toBe(false);
  });

  it('partialize 把 terminalPanelMaximized 排除在持久化之外', () => {
    const partialize = useUIStateStore.persist.getOptions().partialize;
    if (!partialize) {
      throw new Error('useUIStateStore.persist 未配置 partialize');
    }

    const partial = partialize({
      ...useUIStateStore.getState(),
      terminalPanelMaximized: true,
    }) as { terminalPanelMaximized?: boolean };

    expect(partial.terminalPanelMaximized).toBeUndefined();
  });

  it('merge 强制 false：存储里的 true 不得带进启动态', () => {
    const merge = useUIStateStore.persist.getOptions().merge;
    if (!merge) {
      throw new Error('useUIStateStore.persist 未配置 merge');
    }

    const merged = merge(
      { terminalPanelMaximized: true },
      { ...useUIStateStore.getState(), terminalPanelMaximized: true },
    );

    expect(merged.terminalPanelMaximized).toBe(false);
  });
});

describe('readIdentity 瞬态契约（不落盘 + merge 强制空身份）', () => {
  it('默认空身份，setter / clear 只改瞬态字段', () => {
    expect(useUIStateStore.getState().readIdentity).toEqual(EMPTY_READ_IDENTITY);

    useUIStateStore.getState().setReadIdentity({
      sessionId: 'session-1',
      sshConnectionId: null,
      remote: true,
    });
    expect(useUIStateStore.getState().readIdentity).toEqual({
      sessionId: 'session-1',
      sshConnectionId: null,
      remote: true,
    });

    useUIStateStore.getState().clearReadIdentity();
    expect(useUIStateStore.getState().readIdentity).toEqual(EMPTY_READ_IDENTITY);
  });

  it('useWorkspaceReadIdentity 选择器跟随 store 的 setter / clear', () => {
    const { result } = renderHook(() => useWorkspaceReadIdentity());
    expect(result.current).toEqual(EMPTY_READ_IDENTITY);

    act(() => {
      useUIStateStore
        .getState()
        .setReadIdentity({ sessionId: 'session-9', sshConnectionId: null, remote: true });
    });
    expect(result.current).toEqual({ sessionId: 'session-9', sshConnectionId: null, remote: true });

    act(() => {
      useUIStateStore.getState().clearReadIdentity();
    });
    expect(result.current).toEqual(EMPTY_READ_IDENTITY);
  });

  it('partialize 把 readIdentity 排除在持久化之外', () => {
    const partialize = useUIStateStore.persist.getOptions().partialize;
    if (!partialize) {
      throw new Error('useUIStateStore.persist 未配置 partialize');
    }

    const partial = partialize({
      ...useUIStateStore.getState(),
      readIdentity: { sessionId: 'session-1', sshConnectionId: 'conn-1', remote: true },
    }) as { readIdentity?: WorkspaceReadIdentity };

    expect(partial.readIdentity).toBeUndefined();
  });

  it('merge 强制空身份：存储里的跨会话身份不得带进启动态', () => {
    const merge = useUIStateStore.persist.getOptions().merge;
    if (!merge) {
      throw new Error('useUIStateStore.persist 未配置 merge');
    }

    const merged = merge(
      { readIdentity: { sessionId: 'session-old', sshConnectionId: 'conn-old', remote: true } },
      useUIStateStore.getState(),
    );

    expect(merged.readIdentity).toEqual(EMPTY_READ_IDENTITY);
  });
});

describe('terminalPanelPosition 停靠位置（持久化偏好）', () => {
  it('默认底部，setter 在三档位置间往返', () => {
    expect(TERMINAL_PANEL_POSITIONS).toEqual(['bottom', 'left', 'right']);
    expect(useUIStateStore.getState().terminalPanelPosition).toBe('bottom');

    useUIStateStore.getState().setTerminalPanelPosition('right');
    expect(useUIStateStore.getState().terminalPanelPosition).toBe('right');

    useUIStateStore.getState().setTerminalPanelPosition('left');
    expect(useUIStateStore.getState().terminalPanelPosition).toBe('left');

    useUIStateStore.getState().setTerminalPanelPosition('bottom');
    expect(useUIStateStore.getState().terminalPanelPosition).toBe('bottom');
  });

  it('partialize 保留位置（用户布局偏好，不在排除名单里）', () => {
    const partialize = useUIStateStore.persist.getOptions().partialize;
    if (!partialize) {
      throw new Error('useUIStateStore.persist 未配置 partialize');
    }

    const partial = partialize({
      ...useUIStateStore.getState(),
      terminalPanelPosition: 'left',
    }) as { terminalPanelPosition?: string };

    expect(partial.terminalPanelPosition).toBe('left');
  });

  it('merge 把非成员值退回底部，成员值原样保留', () => {
    const merge = useUIStateStore.persist.getOptions().merge;
    if (!merge) {
      throw new Error('useUIStateStore.persist 未配置 merge');
    }
    const current = { ...useUIStateStore.getState(), terminalPanelPosition: 'bottom' as const };

    expect(merge({ terminalPanelPosition: 'diagonal' }, current).terminalPanelPosition).toBe(
      'bottom',
    );
    expect(merge({ terminalPanelPosition: 42 }, current).terminalPanelPosition).toBe('bottom');
    expect(merge({}, current).terminalPanelPosition).toBe('bottom');
    expect(merge({ terminalPanelPosition: 'right' }, current).terminalPanelPosition).toBe('right');
  });

  it('migrate 尾部同样兜底成员校验（同版本脏数据 / 旧数据缺省）', () => {
    expect(
      runPersistMigration({ terminalPanelPosition: 'diagonal' }, 26).terminalPanelPosition,
    ).toBe('bottom');
    expect(runPersistMigration({ terminalPanelPosition: 'left' }, 26).terminalPanelPosition).toBe(
      'left',
    );
    expect(runPersistMigration({}, 1).terminalPanelPosition).toBe('bottom');
  });
});

describe('resolveEffectiveTerminalPanelPosition（窄视口降级）', () => {
  it('宽视口保留三档位置', () => {
    expect(resolveEffectiveTerminalPanelPosition('bottom', false)).toBe('bottom');
    expect(resolveEffectiveTerminalPanelPosition('left', false)).toBe('left');
    expect(resolveEffectiveTerminalPanelPosition('right', false)).toBe('right');
  });

  it('窄视口一律降级为底部', () => {
    expect(resolveEffectiveTerminalPanelPosition('left', true)).toBe('bottom');
    expect(resolveEffectiveTerminalPanelPosition('right', true)).toBe('bottom');
    expect(resolveEffectiveTerminalPanelPosition('bottom', true)).toBe('bottom');
  });
});
