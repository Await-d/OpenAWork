/**
 * 团队会话视图状态存储（纯函数，无 React 依赖，永不抛出）。
 *
 * 以「会话作用域」（scopeKey）为粒度，持久化团队页 V2 的视图状态：
 * - 中层 Tab（middleTab）与「主 Tab → 叶子 Tab」映射（leafByPrimary）；
 * - 8 项页面视图字段（focusMode、officeFullscreen、editorOverlayOpen、editorPaneTab、
 *   browserPreviewUrl、drawerVisible、drawerTargetSessionId、selectedAgentId）；
 * - 可扩展的 Tab 状态表（tabs）。
 *
 * 同时提供旧版三个存储键（纯字符串 / JSON 对象）的读取与一次性迁移能力。
 * 所有 storage 访问与 JSON 解析均被 try/catch 包裹，非法数据一律回退默认值。
 */

import {
  DEFAULT_TEAM_PAGE_VIEW_STATE,
  TEAM_PAGE_VIEW_STATE_STORAGE_KEY,
  normalizeTeamPageViewState,
} from './team-page-view-state-storage.js';
import {
  LEAF_TO_PRIMARY,
  MIDDLE_TAB_KEYS,
  PRIMARY_TABS,
} from '../runtime/tabs/team-page-v2-tabs.js';
import type { PrimaryTabKey } from '../runtime/tabs/team-page-v2-tabs.js';
import type { MiddleTabKey } from '../runtime/tabs/MiddleTabRouter.js';
import type { EditorPaneTab } from '../../../components/file-editor/EditorBrowserWorkspace.js';

/** 会话视图状态存储主键。 */
export const TEAM_SESSION_VIEW_STATE_STORAGE_KEY = 'teamV2.sessionViewState';

/** 旧版中层 Tab 存储键 —— 内容为纯字符串（非 JSON）。 */
export const LEGACY_MIDDLE_TAB_KEY = 'teamV2.middleTab';

/** 旧版页面视图状态存储键 —— 复用页面级存储键，内容为 JSON 对象。 */
export const LEGACY_VIEW_STATE_KEY = TEAM_PAGE_VIEW_STATE_STORAGE_KEY;

/** 旧版「主 Tab → 叶子 Tab」映射存储键 —— 内容为 JSON 对象。 */
export const LEGACY_LEAF_BY_PRIMARY_KEY = 'teamV2.leafByPrimary';

/** 默认会话作用域键：无有效会话 ID 时使用。 */
export const DEFAULT_SESSION_SCOPE_KEY = '__default__';

/** 会话视图状态最多保留的条目数（超出时按 updatedAt 淘汰最旧条目）。 */
export const TEAM_SESSION_VIEW_STATE_MAX_ENTRIES = 50;

/** 单个会话条目内 tabs 最多保留的键数量。 */
export const TEAM_TAB_STATE_MAX_KEYS = 64;

/** Tab 状态值允许的类型。 */
export type TeamTabStateValue = string | boolean | number | readonly string[];

/** 单个会话作用域下的完整视图状态条目。 */
export interface TeamSessionViewEntry {
  /** 最后写入时间戳（毫秒），0 表示从未写入。 */
  readonly updatedAt: number;
  /** 当前中层 Tab。 */
  readonly middleTab: MiddleTabKey;
  /** 各主 Tab 记忆的叶子 Tab。 */
  readonly leafByPrimary: Readonly<Record<string, MiddleTabKey>>;
  /** 是否处于专注模式。 */
  readonly focusMode: boolean;
  /** 办公区是否全屏。 */
  readonly officeFullscreen: boolean;
  /** 编辑器浮层是否打开。 */
  readonly editorOverlayOpen: boolean;
  /** 编辑器面板当前 Tab。 */
  readonly editorPaneTab: EditorPaneTab;
  /** 浏览器预览地址，null 表示未设置。 */
  readonly browserPreviewUrl: string | null;
  /** 抽屉是否可见。 */
  readonly drawerVisible: boolean;
  /** 抽屉目标会话 ID。 */
  readonly drawerTargetSessionId: string | null;
  /** 当前选中的 Agent ID。 */
  readonly selectedAgentId: string | null;
  /** 额外的 Tab 局部状态。 */
  readonly tabs: Readonly<Record<string, TeamTabStateValue>>;
}

/** 以会话作用域键为索引的视图状态集合。 */
export type TeamSessionViewStateMap = Readonly<Record<string, TeamSessionViewEntry>>;

/** 可注入的存储接口（兼容 localStorage / sessionStorage 与测试假实现）。 */
export interface TeamSessionViewStateStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/** 默认会话视图状态条目。 */
export const DEFAULT_TEAM_SESSION_VIEW_ENTRY: TeamSessionViewEntry = {
  updatedAt: 0,
  middleTab: 'conversation',
  leafByPrimary: {},
  focusMode: DEFAULT_TEAM_PAGE_VIEW_STATE.focusMode,
  officeFullscreen: DEFAULT_TEAM_PAGE_VIEW_STATE.officeFullscreen,
  editorOverlayOpen: DEFAULT_TEAM_PAGE_VIEW_STATE.editorOverlayOpen,
  editorPaneTab: DEFAULT_TEAM_PAGE_VIEW_STATE.editorPaneTab,
  browserPreviewUrl: DEFAULT_TEAM_PAGE_VIEW_STATE.browserPreviewUrl,
  drawerVisible: DEFAULT_TEAM_PAGE_VIEW_STATE.drawerVisible,
  drawerTargetSessionId: DEFAULT_TEAM_PAGE_VIEW_STATE.drawerTargetSessionId,
  selectedAgentId: DEFAULT_TEAM_PAGE_VIEW_STATE.selectedAgentId,
  tabs: {},
};

/** 判断值是否为非数组、非 null 的普通对象记录。 */
function isPlainObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 判断值是否为合法中层 Tab。 */
function isMiddleTabKey(value: unknown): value is MiddleTabKey {
  if (typeof value !== 'string') {
    return false;
  }
  for (const key of MIDDLE_TAB_KEYS) {
    if (key === value) {
      return true;
    }
  }
  return false;
}

/** 判断值是否为合法主 Tab 键。 */
function isPrimaryTabKey(value: unknown): value is PrimaryTabKey {
  if (typeof value !== 'string') {
    return false;
  }
  for (const tab of PRIMARY_TABS) {
    if (tab.key === value) {
      return true;
    }
  }
  return false;
}

/** 解析存储宿主：优先注入实现，否则回退 window.localStorage，不可用时返回 null。 */
function resolveStorage(storage?: TeamSessionViewStateStorage): TeamSessionViewStateStorage | null {
  if (storage !== undefined) {
    return storage;
  }
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    // 隐私模式 / 沙箱 iframe 下访问 localStorage 可能抛异常，按不可用处理
    return null;
  }
}

/** 将 JSON 字符串解析为普通对象记录；缺失或非法时返回 null。 */
function parseJsonObjectRecord(raw: string | null): Record<string, unknown> | null {
  if (raw === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPlainObjectRecord(parsed) ? parsed : null;
  } catch {
    // 旧数据可能不是合法 JSON，按缺失处理
    return null;
  }
}

/** 归一化「主 Tab → 叶子 Tab」映射，仅保留合法且配对一致的条目。 */
function normalizeLeafByPrimary(raw: unknown): Readonly<Record<string, MiddleTabKey>> {
  const result: Record<string, MiddleTabKey> = {};
  if (!isPlainObjectRecord(raw)) {
    return result;
  }
  for (const [rawKey, rawValue] of Object.entries(raw)) {
    const key = rawKey.trim();
    if (key.length === 0 || !isPrimaryTabKey(key)) {
      continue;
    }
    if (!isMiddleTabKey(rawValue) || LEAF_TO_PRIMARY.get(rawValue) !== key) {
      continue;
    }
    result[key] = rawValue;
  }
  return result;
}

/** 归一化 Tab 状态表，仅保留合法键值，并按枚举顺序限制最大键数。 */
function normalizeTabs(raw: unknown): Readonly<Record<string, TeamTabStateValue>> {
  const result: Record<string, TeamTabStateValue> = {};
  if (!isPlainObjectRecord(raw)) {
    return result;
  }
  let accepted = 0;
  for (const [rawKey, rawValue] of Object.entries(raw)) {
    if (accepted >= TEAM_TAB_STATE_MAX_KEYS) {
      break;
    }
    const key = rawKey.trim();
    if (key.length === 0) {
      continue;
    }
    const value = normalizeTeamTabStateValue(rawValue);
    if (value === null) {
      continue;
    }
    result[key] = value;
    accepted += 1;
  }
  return result;
}

/** 归一化会话作用域键：去除首尾空白，空值回退到默认作用域。 */
export function normalizeSessionScopeKey(sessionId: string | null | undefined): string {
  if (typeof sessionId !== 'string') {
    return DEFAULT_SESSION_SCOPE_KEY;
  }
  const trimmed = sessionId.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_SESSION_SCOPE_KEY;
}

/** 归一化单个 Tab 状态值；类型不合法时返回 null。 */
export function normalizeTeamTabStateValue(raw: unknown): TeamTabStateValue | null {
  if (typeof raw === 'string' || typeof raw === 'boolean') {
    return raw;
  }
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  if (Array.isArray(raw)) {
    const list: unknown[] = raw;
    const values: string[] = [];
    for (const item of list) {
      if (typeof item !== 'string') {
        return null;
      }
      values.push(item);
    }
    return values;
  }
  return null;
}

/** 归一化单个会话视图状态条目，任何非法字段回退默认值。 */
export function normalizeTeamSessionViewEntry(raw: unknown): TeamSessionViewEntry {
  const record = isPlainObjectRecord(raw) ? raw : {};
  const viewState = normalizeTeamPageViewState(record);
  const rawUpdatedAt = record['updatedAt'];
  const updatedAt =
    typeof rawUpdatedAt === 'number' && Number.isFinite(rawUpdatedAt) && rawUpdatedAt > 0
      ? rawUpdatedAt
      : 0;
  const rawMiddleTab = record['middleTab'];
  const middleTab = isMiddleTabKey(rawMiddleTab) ? rawMiddleTab : 'conversation';
  return {
    updatedAt,
    middleTab,
    leafByPrimary: normalizeLeafByPrimary(record['leafByPrimary']),
    focusMode: viewState.focusMode,
    officeFullscreen: viewState.officeFullscreen,
    editorOverlayOpen: viewState.editorOverlayOpen,
    editorPaneTab: viewState.editorPaneTab,
    browserPreviewUrl: viewState.browserPreviewUrl,
    drawerVisible: viewState.drawerVisible,
    drawerTargetSessionId: viewState.drawerTargetSessionId,
    selectedAgentId: viewState.selectedAgentId,
    tabs: normalizeTabs(record['tabs']),
  };
}

/** 归一化整个会话视图状态集合，丢弃非法键与非对象值。 */
export function normalizeTeamSessionViewStateMap(raw: unknown): TeamSessionViewStateMap {
  const result: Record<string, TeamSessionViewEntry> = {};
  if (!isPlainObjectRecord(raw)) {
    return result;
  }
  for (const [rawKey, rawValue] of Object.entries(raw)) {
    const key = rawKey.trim();
    if (key.length === 0 || !isPlainObjectRecord(rawValue)) {
      continue;
    }
    result[key] = normalizeTeamSessionViewEntry(rawValue);
  }
  return result;
}

/** 读取并归一化会话视图状态集合；存储不可用或数据损坏时返回空集合。 */
export function readTeamSessionViewStateMap(
  storage?: TeamSessionViewStateStorage,
): TeamSessionViewStateMap {
  const target = resolveStorage(storage);
  if (target === null) {
    return {};
  }
  try {
    const raw = target.getItem(TEAM_SESSION_VIEW_STATE_STORAGE_KEY);
    if (raw === null || raw.length === 0) {
      return {};
    }
    return normalizeTeamSessionViewStateMap(JSON.parse(raw));
  } catch {
    // 读取或解析失败时按空状态处理，避免污染调用方
    return {};
  }
}

/** 写入会话视图状态集合；任何写入异常都被吞掉，不阻断交互。 */
export function writeTeamSessionViewStateMap(
  map: TeamSessionViewStateMap,
  storage?: TeamSessionViewStateStorage,
): void {
  const target = resolveStorage(storage);
  if (target === null) {
    return;
  }
  try {
    target.setItem(TEAM_SESSION_VIEW_STATE_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // 写入失败（隐私模式 / 配额不足等）时静默降级
  }
}

/** 解析指定作用域的条目；缺失时返回默认条目。 */
export function resolveTeamSessionViewEntry(
  map: TeamSessionViewStateMap,
  scopeKey: string,
): TeamSessionViewEntry {
  return map[scopeKey] ?? DEFAULT_TEAM_SESSION_VIEW_ENTRY;
}

/** 读取旧版三个存储键并组装为一条会话视图状态；全部缺失/不可解析时返回 null。 */
export function readLegacySessionViewEntry(
  storage?: TeamSessionViewStateStorage,
): TeamSessionViewEntry | null {
  const target = resolveStorage(storage);
  if (target === null) {
    return null;
  }
  let rawMiddleTab: string | null = null;
  let rawViewState: string | null = null;
  let rawLeafByPrimary: string | null = null;
  try {
    rawMiddleTab = target.getItem(LEGACY_MIDDLE_TAB_KEY);
    rawViewState = target.getItem(LEGACY_VIEW_STATE_KEY);
    rawLeafByPrimary = target.getItem(LEGACY_LEAF_BY_PRIMARY_KEY);
  } catch {
    // 任一读取失败即视为无旧数据可用
    return null;
  }
  const middleTab = isMiddleTabKey(rawMiddleTab) ? rawMiddleTab : null;
  const parsedViewState = parseJsonObjectRecord(rawViewState);
  const parsedLeafByPrimary = parseJsonObjectRecord(rawLeafByPrimary);
  if (middleTab === null && parsedViewState === null && parsedLeafByPrimary === null) {
    return null;
  }
  const viewState =
    parsedViewState === null
      ? DEFAULT_TEAM_PAGE_VIEW_STATE
      : normalizeTeamPageViewState(parsedViewState);
  return {
    updatedAt: Date.now(),
    middleTab: middleTab ?? 'conversation',
    leafByPrimary: parsedLeafByPrimary === null ? {} : normalizeLeafByPrimary(parsedLeafByPrimary),
    focusMode: viewState.focusMode,
    officeFullscreen: viewState.officeFullscreen,
    editorOverlayOpen: viewState.editorOverlayOpen,
    editorPaneTab: viewState.editorPaneTab,
    browserPreviewUrl: viewState.browserPreviewUrl,
    drawerVisible: viewState.drawerVisible,
    drawerTargetSessionId: viewState.drawerTargetSessionId,
    selectedAgentId: viewState.selectedAgentId,
    tabs: {},
  };
}

/** 清除旧版三个存储键；removeItem 不可用时退化为写入空字符串。 */
function clearLegacySessionViewState(storage: TeamSessionViewStateStorage): void {
  const legacyKeys = [LEGACY_MIDDLE_TAB_KEY, LEGACY_VIEW_STATE_KEY, LEGACY_LEAF_BY_PRIMARY_KEY];
  for (const key of legacyKeys) {
    try {
      if (typeof storage.removeItem === 'function') {
        storage.removeItem(key);
      } else {
        storage.setItem(key, '');
      }
    } catch {
      // 清理失败不阻断迁移流程
    }
  }
}

/**
 * 将旧版单份视图状态迁移到指定作用域。
 *
 * - 默认作用域、已存在该作用域、无旧数据时原样返回当前集合；
 * - 迁移成功时写入新集合并清除旧键，重复调用保持幂等。
 */
export function migrateLegacySessionViewState(
  scopeKey: string,
  storage?: TeamSessionViewStateStorage,
): TeamSessionViewStateMap {
  const normalizedScopeKey = normalizeSessionScopeKey(scopeKey);
  const map = readTeamSessionViewStateMap(storage);
  if (normalizedScopeKey === DEFAULT_SESSION_SCOPE_KEY) {
    return map;
  }
  if (Object.prototype.hasOwnProperty.call(map, normalizedScopeKey)) {
    return map;
  }
  const legacyEntry = readLegacySessionViewEntry(storage);
  if (legacyEntry === null) {
    return map;
  }
  const migrated = upsertTeamSessionViewEntry(map, normalizedScopeKey, legacyEntry);
  writeTeamSessionViewStateMap(migrated, storage);
  const target = resolveStorage(storage);
  if (target !== null) {
    clearLegacySessionViewState(target);
  }
  return migrated;
}

/**
 * 写入/更新指定作用域的条目。
 *
 * 总是返回新对象（不修改入参）；写入时以当前时间戳覆盖 updatedAt；
 * 条目总数超过上限时保留 updatedAt 最大的 50 条。
 */
export function upsertTeamSessionViewEntry(
  map: TeamSessionViewStateMap,
  scopeKey: string,
  entry: TeamSessionViewEntry,
): TeamSessionViewStateMap {
  const normalizedScopeKey = normalizeSessionScopeKey(scopeKey);
  const next: Record<string, TeamSessionViewEntry> = {
    ...map,
    [normalizedScopeKey]: { ...entry, updatedAt: Date.now() },
  };
  const keys = Object.keys(next);
  if (keys.length <= TEAM_SESSION_VIEW_STATE_MAX_ENTRIES) {
    return next;
  }
  const ranked = keys
    .map((key) => ({ key, updatedAt: next[key]?.updatedAt ?? 0 }))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, TEAM_SESSION_VIEW_STATE_MAX_ENTRIES);
  const pruned: Record<string, TeamSessionViewEntry> = {};
  for (const item of ranked) {
    const value = next[item.key];
    if (value !== undefined) {
      pruned[item.key] = value;
    }
  }
  return pruned;
}
