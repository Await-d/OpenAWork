/**
 * 团队页（TeamPageV2）页面排布态持久化。
 *
 * 只保存「浏览器刷新后应当恢复的排布」：焦点模式、办公全屏、编辑器浮层与其
 * 激活 tab、浏览器预览地址、底部层级对话抽屉、当前选中角色。弹窗 / 忙碌态 /
 * 提示 / 错误等瞬态刻意不落盘。
 *
 * 存储约定与 `runtime/tabs/team-page-v2-tabs.ts` 一致：
 *   - 可选注入 storage，便于单测；
 *   - `typeof window === 'undefined'`（SSR / 无窗口环境）时视为无存储；
 *   - 每一次存储访问都包在 try/catch 里（隐私模式 / 配额超限会抛错）；
 *   - 任何异常都不向外抛——存储只是增强能力，不阻塞交互。
 */

import type { EditorPaneTab } from '../../../components/file-editor/EditorBrowserWorkspace.js';

/** localStorage 键名：与 teamV2.* 既有键并列，避免相互迁移。 */
export const TEAM_PAGE_VIEW_STATE_STORAGE_KEY = 'teamV2.viewState';

export interface TeamPageViewStateSnapshot {
  readonly focusMode: boolean;
  readonly officeFullscreen: boolean;
  readonly editorOverlayOpen: boolean;
  readonly editorPaneTab: EditorPaneTab;
  readonly browserPreviewUrl: string | null;
  readonly drawerVisible: boolean;
  readonly drawerTargetSessionId: string | null;
  readonly selectedAgentId: string | null;
}

export const DEFAULT_TEAM_PAGE_VIEW_STATE: TeamPageViewStateSnapshot = {
  focusMode: false,
  officeFullscreen: false,
  editorOverlayOpen: false,
  editorPaneTab: 'code',
  browserPreviewUrl: null,
  drawerVisible: false,
  drawerTargetSessionId: null,
  selectedAgentId: null,
};

/** 可注入的存储接口（便于单测；默认取 window.localStorage）。 */
export interface TeamPageViewStateStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function resolveStorage(storage?: TeamPageViewStateStorage): TeamPageViewStateStorage | null {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    // 隐私模式等场景访问 localStorage 会抛错，视为无存储
    return null;
  }
}

/** 把任意原始输入收敛为普通对象；null / 数组 / 原始值统一视为空对象。 */
function toRecord(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {};
  }
  return raw as Record<string, unknown>;
}

/** 只接受真实布尔值；其他类型一律回落到默认值。 */
function readBooleanField(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** 只接受「去首尾空白后非空」的字符串并返回去空白结果；其他情况回落 null。 */
function readTrimmedStringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** 编辑器浮层 tab 只认 'code' | 'browser'，非法值回落到 'code'。 */
function readEditorPaneTab(value: unknown): EditorPaneTab {
  return value === 'browser' ? 'browser' : 'code';
}

/** 逐字段类型校验；任何缺失 / 非法 / 未知字段一律回落到默认值。 */
export function normalizeTeamPageViewState(raw: unknown): TeamPageViewStateSnapshot {
  const record = toRecord(raw);
  return {
    focusMode: readBooleanField(record.focusMode, DEFAULT_TEAM_PAGE_VIEW_STATE.focusMode),
    officeFullscreen: readBooleanField(
      record.officeFullscreen,
      DEFAULT_TEAM_PAGE_VIEW_STATE.officeFullscreen,
    ),
    editorOverlayOpen: readBooleanField(
      record.editorOverlayOpen,
      DEFAULT_TEAM_PAGE_VIEW_STATE.editorOverlayOpen,
    ),
    editorPaneTab: readEditorPaneTab(record.editorPaneTab),
    browserPreviewUrl: readTrimmedStringOrNull(record.browserPreviewUrl),
    drawerVisible: readBooleanField(
      record.drawerVisible,
      DEFAULT_TEAM_PAGE_VIEW_STATE.drawerVisible,
    ),
    drawerTargetSessionId: readTrimmedStringOrNull(record.drawerTargetSessionId),
    selectedAgentId: readTrimmedStringOrNull(record.selectedAgentId),
  };
}

/** 读取快照：解析失败 / 存储不可用时返回默认快照。 */
export function readTeamPageViewState(
  storage?: TeamPageViewStateStorage,
): TeamPageViewStateSnapshot {
  const store = resolveStorage(storage);
  if (!store) return { ...DEFAULT_TEAM_PAGE_VIEW_STATE };
  try {
    const raw = store.getItem(TEAM_PAGE_VIEW_STATE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_TEAM_PAGE_VIEW_STATE };
    const parsed: unknown = JSON.parse(raw);
    return normalizeTeamPageViewState(parsed);
  } catch {
    // 解析失败（脏数据）与读取抛错统一视为无记录，回落到默认快照
    return { ...DEFAULT_TEAM_PAGE_VIEW_STATE };
  }
}
