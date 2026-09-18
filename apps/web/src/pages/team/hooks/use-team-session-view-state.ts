/**
 * 团队页 V2 会话视图状态 hook（按会话作用域记忆）。
 *
 * 设计要点：**ref 权威 + 写穿（write-through）**，刻意不用「镜像 state + persist effect」。
 * 会话 A → B 切换时，persist effect 可能在同一次 commit 里带着 A 的旧值、按 B 的作用域
 * 落盘，把 A 的排布写进 B 的记忆（并抹掉 B 原本的记忆）。
 *
 * 本 hook 的约束：
 *   - scopeRef / entryRef 只由「作用域 effect」更新，二者始终是一对一致的值；
 *   - 所有 setter 都从 entryRef.current 计算下一个值（不读 React state、不在 setState updater
 *     里算），再经唯一出口 commit() 落盘；
 *   - commit() 读取 scopeRef.current：默认作用域（无会话）直接返回、永不写盘，
 *     这样欢迎页永远不会冲掉某个会话的记忆。
 *
 * 因为 refs 永远在用户事件之前同步成对更新，跨作用域写入在结构上不可能发生。
 */

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { EditorPaneTab } from '../../../components/file-editor/EditorBrowserWorkspace.js';
import { LEAF_TO_PRIMARY, MIDDLE_TAB_KEYS } from '../runtime/tabs/team-page-v2-tabs.js';
import type { PrimaryTabKey } from '../runtime/tabs/team-page-v2-tabs.js';
import type { MiddleTabKey } from '../runtime/tabs/MiddleTabRouter.js';
import {
  DEFAULT_SESSION_SCOPE_KEY,
  DEFAULT_TEAM_SESSION_VIEW_ENTRY,
  migrateLegacySessionViewState,
  normalizeSessionScopeKey,
  normalizeTeamTabStateValue,
  readTeamSessionViewStateMap,
  resolveTeamSessionViewEntry,
  upsertTeamSessionViewEntry,
  writeTeamSessionViewStateMap,
  type TeamSessionViewEntry,
  type TeamSessionViewStateMap,
  type TeamTabStateValue,
} from './team-session-view-state-storage.js';

/**
 * 底部「层级对话」抽屉要聚焦的角色实例。nonce 用于让「收起抽屉后再点同一张卡片」
 * 也能重新展开（只比 sessionId 的话 props 不变、effect 不触发）。
 */
export interface TeamPageDrawerTarget {
  readonly sessionId: string;
  readonly nonce: number;
}

export interface TeamSessionViewStateControls {
  /** 当前会话作用域键（渲染期计算，非 ref）。 */
  scopeKey: string;
  middleTab: MiddleTabKey;
  setMiddleTab: (next: MiddleTabKey) => void;
  leafByPrimary: Readonly<Record<string, MiddleTabKey>>;
  readRememberedLeaf: (primary: PrimaryTabKey) => MiddleTabKey | null;
  rememberLeaf: (leaf: MiddleTabKey) => void;
  selectedAgentId: string;
  setSelectedAgentId: Dispatch<SetStateAction<string>>;
  drawerVisible: boolean;
  setDrawerVisible: Dispatch<SetStateAction<boolean>>;
  drawerTarget: TeamPageDrawerTarget | null;
  setDrawerTarget: Dispatch<SetStateAction<TeamPageDrawerTarget | null>>;
  focusMode: boolean;
  setFocusMode: Dispatch<SetStateAction<boolean>>;
  showOfficeFullscreen: boolean;
  setShowOfficeFullscreen: Dispatch<SetStateAction<boolean>>;
  editorOverlayOpen: boolean;
  setEditorOverlayOpen: Dispatch<SetStateAction<boolean>>;
  browserPreviewUrl: string | null;
  setBrowserPreviewUrl: Dispatch<SetStateAction<string | null>>;
  editorPaneTab: EditorPaneTab;
  setEditorPaneTab: Dispatch<SetStateAction<EditorPaneTab>>;
  readTabState<T extends TeamTabStateValue>(key: string, fallback: T): T;
  writeTabState(key: string, value: TeamTabStateValue): void;
}

export function useTeamSessionViewState(input: {
  readonly sessionId: string | null;
}): TeamSessionViewStateControls {
  // 只水合一次：挂载后再也不重读 storage，之后的权威来源是 mapRef / entryRef。
  const [initialMap] = useState<TeamSessionViewStateMap>(() => readTeamSessionViewStateMap());
  const mapRef = useRef<TeamSessionViewStateMap>(initialMap);
  const entryRef = useRef<TeamSessionViewEntry>(DEFAULT_TEAM_SESSION_VIEW_ENTRY);
  const scopeRef = useRef<string>(DEFAULT_SESSION_SCOPE_KEY);
  // 只有 drawerTarget 需要额外 ref：它是带 nonce 的对象，无法从 entryRef 精确还原。
  const drawerTargetRef = useRef<TeamPageDrawerTarget | null>(null);

  const scopeKey = normalizeSessionScopeKey(input.sessionId);

  const [middleTab, setMiddleTabState] = useState<MiddleTabKey>(
    DEFAULT_TEAM_SESSION_VIEW_ENTRY.middleTab,
  );
  const [leafByPrimary, setLeafByPrimaryState] = useState<Readonly<Record<string, MiddleTabKey>>>(
    DEFAULT_TEAM_SESSION_VIEW_ENTRY.leafByPrimary,
  );
  const [focusMode, setFocusModeState] = useState<boolean>(
    DEFAULT_TEAM_SESSION_VIEW_ENTRY.focusMode,
  );
  const [showOfficeFullscreen, setShowOfficeFullscreenState] = useState<boolean>(
    DEFAULT_TEAM_SESSION_VIEW_ENTRY.officeFullscreen,
  );
  const [editorOverlayOpen, setEditorOverlayOpenState] = useState<boolean>(
    DEFAULT_TEAM_SESSION_VIEW_ENTRY.editorOverlayOpen,
  );
  const [editorPaneTab, setEditorPaneTabState] = useState<EditorPaneTab>(
    DEFAULT_TEAM_SESSION_VIEW_ENTRY.editorPaneTab,
  );
  const [browserPreviewUrl, setBrowserPreviewUrlState] = useState<string | null>(
    DEFAULT_TEAM_SESSION_VIEW_ENTRY.browserPreviewUrl,
  );
  const [drawerVisible, setDrawerVisibleState] = useState<boolean>(
    DEFAULT_TEAM_SESSION_VIEW_ENTRY.drawerVisible,
  );
  const [drawerTarget, setDrawerTargetState] = useState<TeamPageDrawerTarget | null>(null);
  const [selectedAgentId, setSelectedAgentIdState] = useState<string>(
    DEFAULT_TEAM_SESSION_VIEW_ENTRY.selectedAgentId ?? '',
  );

  // 作用域切换时装载该会话的记忆；无会话时装载默认条目（同时把 3D 全屏 / 编辑器浮层 /
  // 抽屉复位），且此作用域永不写盘。
  //
  // 这里用 useLayoutEffect 而不是 useEffect：子组件的 useEffect 先于父组件的 useEffect 执行，
  // 若本 effect 是被动 effect，子组件（useTeamTabState）会在 entryRef 尚未切换时读到旧会话的
  // 记忆；layout effect 一定先于所有被动 effect 完成，保证读取到的 refs 已是新作用域。
  useLayoutEffect(() => {
    // 首次打开某会话且新存储里没有该作用域时，尝试一次性迁移旧版三个键。
    if (scopeKey !== DEFAULT_SESSION_SCOPE_KEY && mapRef.current[scopeKey] === undefined) {
      const migrated = migrateLegacySessionViewState(scopeKey);
      // 迁移函数会重新读取 storage：只有确实产出该作用域条目时才采纳结果，
      // 否则采纳会丢掉本次挂载前写入内存、但尚未落盘的其他条目。
      if (migrated[scopeKey] !== undefined) {
        mapRef.current = migrated;
      }
    }
    const nextEntry = resolveTeamSessionViewEntry(mapRef.current, scopeKey);
    scopeRef.current = scopeKey;
    entryRef.current = nextEntry;
    drawerTargetRef.current = nextEntry.drawerTargetSessionId
      ? { sessionId: nextEntry.drawerTargetSessionId, nonce: 0 }
      : null;
    setMiddleTabState(nextEntry.middleTab);
    setLeafByPrimaryState(nextEntry.leafByPrimary);
    setFocusModeState(nextEntry.focusMode);
    setShowOfficeFullscreenState(nextEntry.officeFullscreen);
    setEditorOverlayOpenState(nextEntry.editorOverlayOpen);
    setEditorPaneTabState(nextEntry.editorPaneTab);
    setBrowserPreviewUrlState(nextEntry.browserPreviewUrl);
    setDrawerVisibleState(nextEntry.drawerVisible);
    setDrawerTargetState(drawerTargetRef.current);
    setSelectedAgentIdState(nextEntry.selectedAgentId ?? '');
  }, [scopeKey]);

  // 唯一写盘出口：从 scopeRef 取当前作用域，无会话作用域直接返回、永不写盘。
  const commit = useCallback((patch: Partial<TeamSessionViewEntry>) => {
    const scope = scopeRef.current;
    if (scope === DEFAULT_SESSION_SCOPE_KEY) {
      return;
    }
    const next: TeamSessionViewEntry = { ...entryRef.current, ...patch, updatedAt: Date.now() };
    entryRef.current = next;
    mapRef.current = upsertTeamSessionViewEntry(mapRef.current, scope, next);
    writeTeamSessionViewStateMap(mapRef.current);
  }, []);

  // 以下 setter 全部：先读 entryRef.current 求下一个值 → 更新镜像 → commit。
  // 计算绝不依赖 React state，避免同一批事件里多个 setter 互相看不见。

  const setFocusMode = useCallback(
    (value: SetStateAction<boolean>) => {
      const next = typeof value === 'function' ? value(entryRef.current.focusMode) : value;
      setFocusModeState(next);
      commit({ focusMode: next });
    },
    [commit],
  );

  const setShowOfficeFullscreen = useCallback(
    (value: SetStateAction<boolean>) => {
      const next = typeof value === 'function' ? value(entryRef.current.officeFullscreen) : value;
      setShowOfficeFullscreenState(next);
      commit({ officeFullscreen: next });
    },
    [commit],
  );

  const setEditorOverlayOpen = useCallback(
    (value: SetStateAction<boolean>) => {
      const next = typeof value === 'function' ? value(entryRef.current.editorOverlayOpen) : value;
      setEditorOverlayOpenState(next);
      commit({ editorOverlayOpen: next });
    },
    [commit],
  );

  const setEditorPaneTab = useCallback(
    (value: SetStateAction<EditorPaneTab>) => {
      const next = typeof value === 'function' ? value(entryRef.current.editorPaneTab) : value;
      setEditorPaneTabState(next);
      commit({ editorPaneTab: next });
    },
    [commit],
  );

  const setBrowserPreviewUrl = useCallback(
    (value: SetStateAction<string | null>) => {
      const next = typeof value === 'function' ? value(entryRef.current.browserPreviewUrl) : value;
      setBrowserPreviewUrlState(next);
      commit({ browserPreviewUrl: next });
    },
    [commit],
  );

  const setDrawerVisible = useCallback(
    (value: SetStateAction<boolean>) => {
      const next = typeof value === 'function' ? value(entryRef.current.drawerVisible) : value;
      setDrawerVisibleState(next);
      commit({ drawerVisible: next });
    },
    [commit],
  );

  const setSelectedAgentId = useCallback(
    (value: SetStateAction<string>) => {
      const next =
        typeof value === 'function' ? value(entryRef.current.selectedAgentId ?? '') : value;
      setSelectedAgentIdState(next);
      // 组件侧「无选中」语义是空串，落盘时归一化为 null。
      commit({ selectedAgentId: next.trim() === '' ? null : next });
    },
    [commit],
  );

  const setDrawerTarget = useCallback(
    (value: SetStateAction<TeamPageDrawerTarget | null>) => {
      const prev = drawerTargetRef.current;
      const next = typeof value === 'function' ? value(prev) : value;
      drawerTargetRef.current = next;
      setDrawerTargetState(next);
      commit({ drawerTargetSessionId: next?.sessionId ?? null });
    },
    [commit],
  );

  // 切中层 tab 时顺带记录「主 tab → 叶子」记忆；'office' 不属于任何主 tab，只切 middleTab。
  const setMiddleTab = useCallback(
    (next: MiddleTabKey) => {
      const primary = LEAF_TO_PRIMARY.get(next);
      const currentLeafByPrimary = entryRef.current.leafByPrimary;
      const nextLeafByPrimary =
        primary === undefined ? currentLeafByPrimary : { ...currentLeafByPrimary, [primary]: next };
      setMiddleTabState(next);
      setLeafByPrimaryState(nextLeafByPrimary);
      if (primary === undefined) {
        commit({ middleTab: next });
        return;
      }
      commit({ middleTab: next, leafByPrimary: nextLeafByPrimary });
    },
    [commit],
  );

  // 只更新「主 tab → 叶子」记忆，不动 middleTab。
  const rememberLeaf = useCallback(
    (leaf: MiddleTabKey) => {
      const primary = LEAF_TO_PRIMARY.get(leaf);
      if (primary === undefined) {
        return;
      }
      const nextLeafByPrimary = { ...entryRef.current.leafByPrimary, [primary]: leaf };
      setLeafByPrimaryState(nextLeafByPrimary);
      commit({ leafByPrimary: nextLeafByPrimary });
    },
    [commit],
  );

  // 读本会话记忆的叶子 tab：必须是合法 leaf 且与主 tab 配对一致，否则返回 null。
  const readRememberedLeaf = useCallback(
    (primary: PrimaryTabKey): MiddleTabKey | null => {
      const candidate = leafByPrimary[primary];
      if (candidate === undefined || !MIDDLE_TAB_KEYS.has(candidate)) {
        return null;
      }
      return LEAF_TO_PRIMARY.get(candidate) === primary ? candidate : null;
    },
    [leafByPrimary],
  );

  const readTabState = useCallback(<T extends TeamTabStateValue>(key: string, fallback: T): T => {
    const candidate = entryRef.current.tabs[key.trim()];
    if (candidate === undefined) {
      return fallback;
    }
    // 类型不一致（含数组 / 原始值错配）时一律回退 fallback，避免把脏数据交给消费方。
    if (Array.isArray(candidate) !== Array.isArray(fallback)) {
      return fallback;
    }
    if (typeof candidate !== typeof fallback) {
      return fallback;
    }
    return candidate as T;
  }, []);

  const writeTabState = useCallback(
    (key: string, value: TeamTabStateValue) => {
      const trimmedKey = key.trim();
      if (trimmedKey.length === 0) {
        return;
      }
      const normalized = normalizeTeamTabStateValue(value);
      if (normalized === null) {
        return;
      }
      commit({ tabs: { ...entryRef.current.tabs, [trimmedKey]: normalized } });
    },
    [commit],
  );

  return {
    scopeKey,
    middleTab,
    setMiddleTab,
    leafByPrimary,
    readRememberedLeaf,
    rememberLeaf,
    selectedAgentId,
    setSelectedAgentId,
    drawerVisible,
    setDrawerVisible,
    drawerTarget,
    setDrawerTarget,
    focusMode,
    setFocusMode,
    showOfficeFullscreen,
    setShowOfficeFullscreen,
    editorOverlayOpen,
    setEditorOverlayOpen,
    browserPreviewUrl,
    setBrowserPreviewUrl,
    editorPaneTab,
    setEditorPaneTab,
    readTabState,
    writeTabState,
  };
}
