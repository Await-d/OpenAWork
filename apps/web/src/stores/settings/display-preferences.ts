import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { DialogueMode } from '@openAwork/shared';
import {
  writeThemeStyle as storageWriteThemeStyle,
  writeThemeMode as storageWriteThemeMode,
  readThemeStyle as storageReadThemeStyle,
  readThemeMode as storageReadThemeMode,
} from './theme-storage.js';

/**
 * 主题模式。
 * - `system`：跟随系统 prefers-color-scheme
 * - `light`：强制浅色
 * - `dark`：强制深色
 */
export type ThemeMode = 'system' | 'light' | 'dark';

/**
 * 主题风格。
 * - `nebula`：靛青+琥珀四色系（项目默认）
 * - `aurora`：极光毛玻璃 + 渐变
 * - `linear`：极简精致 + 单一靛蓝
 * - `forest`：森林墨绿 + 暖橙
 * - `sakura`：樱花粉墨 + 玫红
 * - `carbon`：纯碳灰 + 电光蓝
 * - `sunset`：暮光紫橙 + 落日金
 * - `ocean`：深海青蓝 + 珊瑚
 */
export type ThemeStyle =
  'nebula' | 'aurora' | 'linear' | 'forest' | 'sakura' | 'carbon' | 'sunset' | 'ocean';

/**
 * 工具折叠类别——按用户可感知的工具类型分组，控制聊天页面中各类型工具调用的默认展开/折叠行为。
 * - `bash`：Shell 命令（bash / interactive_bash）
 * - `fileEdit`：文件写入/编辑（write / edit / multi_edit / apply_patch / hash_edit）
 * - `fileRead`：文件读取/搜索（read / grep / glob / list / codesearch / ast_grep_*）
 * - `mcp`：MCP 工具调用（mcp_call / mcp_list_tools / mcp_* 前缀 / skill_mcp）
 * - `skill`：Skill 工具调用（skill）
 * - `web`：网络工具（webfetch / websearch / google_search）
 * - `batch`：批量工具调用
 * - `other`：其他未分类工具
 */
export type ToolExpandCategory =
  'bash' | 'fileEdit' | 'fileRead' | 'mcp' | 'skill' | 'web' | 'batch' | 'other';

export type ToolExpandOverrides = Record<ToolExpandCategory, boolean>;

/**
 * 消息布局模式。
 * - `unified`：统一左对齐——所有消息（user / assistant）头像在左、内容在右，占满宽度（默认）。
 * - `split`：左右分列——user 消息靠右对齐，assistant 消息靠左对齐，各自有最大宽度限制。
 */
export type MessageLayoutMode = 'unified' | 'split';

/**
 * 将工具名映射到折叠类别，用于按类别控制工具调用的默认展开/折叠行为。
 */
export function classifyToolName(toolName: string): ToolExpandCategory {
  const n = toolName.trim().toLowerCase();
  if (n === 'bash' || n === 'interactive_bash') return 'bash';
  if (
    n === 'write' ||
    n === 'edit' ||
    n === 'multi_edit' ||
    n === 'apply_patch' ||
    n === 'hash_edit' ||
    n === 'workspace_create_directory' ||
    n === 'workspace_review_revert'
  )
    return 'fileEdit';
  if (
    n === 'read' ||
    n === 'grep' ||
    n === 'glob' ||
    n === 'list' ||
    n === 'codesearch' ||
    n === 'ast_grep_search' ||
    n === 'ast_grep_replace' ||
    n === 'workspace_review_status' ||
    n === 'session_list' ||
    n === 'session_read' ||
    n === 'session_search'
  )
    return 'fileRead';
  if (n === 'mcp_call' || n === 'mcp_list_tools' || n === 'skill_mcp' || n.startsWith('mcp_'))
    return 'mcp';
  if (n === 'skill') return 'skill';
  if (n === 'webfetch' || n === 'websearch' || n === 'google_search') return 'web';
  if (n === 'batch') return 'batch';
  return 'other';
}

export const TOOL_EXPAND_CATEGORY_LABELS: Record<ToolExpandCategory, string> = {
  bash: 'Bash 命令',
  fileEdit: '文件编辑',
  fileRead: '文件读取 / 搜索',
  mcp: 'MCP 工具',
  skill: 'Skill 技能',
  web: '网络工具',
  batch: '批量调用',
  other: '其他工具',
};

/**
 * 显示偏好设置——控制界面中各 UI 元素的显隐与行为。
 * 纯前端状态，持久化到 localStorage，不依赖后端。
 *
 * 每个设置项都映射到系统中真实存在的 UI 元素：
 * - 消息元信息行（ChatPageSections.tsx 的 MetaLine）
 * - Composer 统计栏（ComposerStatsBar.tsx）
 * - 推理块折叠行为（assistant-reasoning-block.tsx）
 * - 工具调用展开行为（block-tool-call.tsx）
 * - 顶栏按钮显隐（ChatTopBar.tsx）
 * - 导航栏状态点显隐（NavRail.tsx）
 * - 主题模式（App.tsx theme state）
 */
export interface DisplayPreferencesStore {
  // ── 消息元信息 ────────────────────────────────────────────

  showMessageTimestamps: boolean;
  setShowMessageTimestamps: (v: boolean) => void;

  showProviderLabel: boolean;
  setShowProviderLabel: (v: boolean) => void;

  showModelName: boolean;
  setShowModelName: (v: boolean) => void;

  showDuration: boolean;
  setShowDuration: (v: boolean) => void;

  showStopReason: boolean;
  setShowStopReason: (v: boolean) => void;

  showTokenBreakdown: boolean;
  setShowTokenBreakdown: (v: boolean) => void;

  showEstimatedTokens: boolean;
  setShowEstimatedTokens: (v: boolean) => void;

  // ── 消息布局 ──────────────────────────────────────────────

  messageLayout: MessageLayoutMode;
  setMessageLayout: (v: MessageLayoutMode) => void;

  // ── 推理与工具调用 ────────────────────────────────────────

  showReasoningBlock: boolean;
  setShowReasoningBlock: (v: boolean) => void;

  reasoningExpandedByDefault: boolean;
  setReasoningExpandedByDefault: (v: boolean) => void;

  toolCallsExpandedByDefault: boolean;
  setToolCallsExpandedByDefault: (v: boolean) => void;

  /**
   * 按工具类别控制默认展开行为。
   * - 当 `toolCallsExpandedByDefault` 为 `false`（默认）：所有工具默认折叠，此字段无效果。
   * - 当 `toolCallsExpandedByDefault` 为 `true`：某类工具在此处设为 `false` 后仍默认折叠，
   *   其余类别跟随全局开关展开。
   */
  toolExpandedOverrides: ToolExpandOverrides;
  setToolExpandedOverride: (category: ToolExpandCategory, expanded: boolean) => void;

  // ── 对话模式 ──────────────────────────────────────────────

  /**
   * 新会话的默认对话模式（clarify / coding / programmer）。
   * 仅在创建新会话或重置会话时使用；已有会话从元数据恢复。
   */
  defaultDialogueMode: DialogueMode;
  setDefaultDialogueMode: (v: DialogueMode) => void;

  // ── 输入区 ────────────────────────────────────────────────

  showComposerStatsBar: boolean;
  setShowComposerStatsBar: (v: boolean) => void;

  // ── 界面元素显隐 ──────────────────────────────────────────

  showCommandPaletteButton: boolean;
  setShowCommandPaletteButton: (v: boolean) => void;

  showGatewayStatusIndicator: boolean;
  setShowGatewayStatusIndicator: (v: boolean) => void;

  showTerminalButton: boolean;
  setShowTerminalButton: (v: boolean) => void;

  // ── 外观 ──────────────────────────────────────────────────

  themeMode: ThemeMode;
  setThemeMode: (v: ThemeMode) => void;

  themeStyle: ThemeStyle;
  setThemeStyle: (v: ThemeStyle) => void;

  /** 重置全部为默认值 */
  resetToDefaults: () => void;
}

type DisplayPreferenceValues = Omit<
  DisplayPreferencesStore,
  | 'setShowMessageTimestamps'
  | 'setShowProviderLabel'
  | 'setShowModelName'
  | 'setShowDuration'
  | 'setShowStopReason'
  | 'setShowTokenBreakdown'
  | 'setShowEstimatedTokens'
  | 'setMessageLayout'
  | 'setShowReasoningBlock'
  | 'setReasoningExpandedByDefault'
  | 'setToolCallsExpandedByDefault'
  | 'setToolExpandedOverride'
  | 'setDefaultDialogueMode'
  | 'setShowComposerStatsBar'
  | 'setShowCommandPaletteButton'
  | 'setShowGatewayStatusIndicator'
  | 'setShowTerminalButton'
  | 'setThemeMode'
  | 'setThemeStyle'
  | 'resetToDefaults'
>;

const DISPLAY_PREFERENCES_STORAGE_KEY = 'openAwork-display-preferences';

/**
 * 工具类别折叠默认值——所有类别默认折叠（false）。
 * 用户可在设置中按类别开启默认展开。
 */
const DEFAULT_TOOL_EXPAND_OVERRIDES: ToolExpandOverrides = {
  bash: false,
  fileEdit: false,
  fileRead: false,
  mcp: false,
  skill: false,
  web: false,
  batch: false,
  other: false,
};

const DEFAULTS: DisplayPreferenceValues = {
  showMessageTimestamps: true,
  showProviderLabel: true,
  showModelName: true,
  showDuration: true,
  showStopReason: true,
  showTokenBreakdown: true,
  showEstimatedTokens: true,
  messageLayout: 'unified',
  showReasoningBlock: true,
  reasoningExpandedByDefault: false,
  toolCallsExpandedByDefault: false,
  toolExpandedOverrides: { ...DEFAULT_TOOL_EXPAND_OVERRIDES },
  defaultDialogueMode: 'coding',
  showComposerStatsBar: true,
  showCommandPaletteButton: true,
  showGatewayStatusIndicator: true,
  showTerminalButton: true,
  // 直接从 localStorage 读取，不依赖 Zustand persist 水合时序
  themeMode: typeof window !== 'undefined' ? storageReadThemeMode() : 'system',
  themeStyle: typeof window !== 'undefined' ? storageReadThemeStyle() : 'nebula',
};

export const useDisplayPreferencesStore = create<DisplayPreferencesStore>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setShowMessageTimestamps: (v) => {
        set({ showMessageTimestamps: v });
        void persistToLocalStorage();
      },
      setShowProviderLabel: (v) => {
        set({ showProviderLabel: v });
        void persistToLocalStorage();
      },
      setShowModelName: (v) => {
        set({ showModelName: v });
        void persistToLocalStorage();
      },
      setShowDuration: (v) => {
        set({ showDuration: v });
        void persistToLocalStorage();
      },
      setShowStopReason: (v) => {
        set({ showStopReason: v });
        void persistToLocalStorage();
      },
      setShowTokenBreakdown: (v) => {
        set({ showTokenBreakdown: v });
        void persistToLocalStorage();
      },
      setShowEstimatedTokens: (v) => {
        set({ showEstimatedTokens: v });
        void persistToLocalStorage();
      },
      setMessageLayout: (v) => {
        set({ messageLayout: v });
        void persistToLocalStorage();
      },
      setShowReasoningBlock: (v) => {
        set({ showReasoningBlock: v });
        void persistToLocalStorage();
      },
      setReasoningExpandedByDefault: (v) => {
        set({ reasoningExpandedByDefault: v });
        void persistToLocalStorage();
      },
      setToolCallsExpandedByDefault: (v) => {
        set({ toolCallsExpandedByDefault: v });
        void persistToLocalStorage();
      },
      setToolExpandedOverride: (category, expanded) => {
        set((s) => ({
          toolExpandedOverrides: { ...s.toolExpandedOverrides, [category]: expanded },
        }));
        void persistToLocalStorage();
      },
      setDefaultDialogueMode: (v) => {
        set({ defaultDialogueMode: v });
        void persistToLocalStorage();
      },
      setShowComposerStatsBar: (v) => {
        set({ showComposerStatsBar: v });
        void persistToLocalStorage();
      },
      setShowCommandPaletteButton: (v) => {
        set({ showCommandPaletteButton: v });
        void persistToLocalStorage();
      },
      setShowGatewayStatusIndicator: (v) => {
        set({ showGatewayStatusIndicator: v });
        void persistToLocalStorage();
      },
      setShowTerminalButton: (v) => {
        set({ showTerminalButton: v });
        void persistToLocalStorage();
      },
      setThemeMode: (v) => {
        console.log('[theme-store] setThemeMode:', v);
        storageWriteThemeMode(v);
        set({ themeMode: v });
        void persistToLocalStorage();
      },
      setThemeStyle: (v) => {
        console.log('[theme-store] setThemeStyle:', v);
        storageWriteThemeStyle(v);
        set({ themeStyle: v });
        void persistToLocalStorage();
      },
      resetToDefaults: () => {
        set({ ...DEFAULTS });
        void persistToLocalStorage();
      },
    }),
    {
      name: DISPLAY_PREFERENCES_STORAGE_KEY,
      version: 6,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        showMessageTimestamps: s.showMessageTimestamps,
        showProviderLabel: s.showProviderLabel,
        showModelName: s.showModelName,
        showDuration: s.showDuration,
        showStopReason: s.showStopReason,
        showTokenBreakdown: s.showTokenBreakdown,
        showEstimatedTokens: s.showEstimatedTokens,
        messageLayout: s.messageLayout,
        showReasoningBlock: s.showReasoningBlock,
        reasoningExpandedByDefault: s.reasoningExpandedByDefault,
        toolCallsExpandedByDefault: s.toolCallsExpandedByDefault,
        toolExpandedOverrides: s.toolExpandedOverrides,
        defaultDialogueMode: s.defaultDialogueMode,
        showComposerStatsBar: s.showComposerStatsBar,
        showCommandPaletteButton: s.showCommandPaletteButton,
        showGatewayStatusIndicator: s.showGatewayStatusIndicator,
        showTerminalButton: s.showTerminalButton,
        themeMode: s.themeMode,
        themeStyle: s.themeStyle,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          try {
            localStorage.setItem('theme-style', state.themeStyle);
            localStorage.setItem('theme-mode', state.themeMode);
            console.log('[theme-store] onRehydrate:', state.themeStyle, state.themeMode);
          } catch {
            // ignore
          }
        }
      },
    },
  ),
);

/**
 * 手动将当前 store 状态序列化写入 localStorage。
 * 作为 Zustand persist 的备份写入机制，确保持久化一定生效。
 */
function persistToLocalStorage() {
  try {
    const state = useDisplayPreferencesStore.getState();
    const data = {
      showMessageTimestamps: state.showMessageTimestamps,
      showProviderLabel: state.showProviderLabel,
      showModelName: state.showModelName,
      showDuration: state.showDuration,
      showStopReason: state.showStopReason,
      showTokenBreakdown: state.showTokenBreakdown,
      showEstimatedTokens: state.showEstimatedTokens,
      messageLayout: state.messageLayout,
      showReasoningBlock: state.showReasoningBlock,
      reasoningExpandedByDefault: state.reasoningExpandedByDefault,
      toolCallsExpandedByDefault: state.toolCallsExpandedByDefault,
      toolExpandedOverrides: state.toolExpandedOverrides,
      defaultDialogueMode: state.defaultDialogueMode,
      showComposerStatsBar: state.showComposerStatsBar,
      showCommandPaletteButton: state.showCommandPaletteButton,
      showGatewayStatusIndicator: state.showGatewayStatusIndicator,
      showTerminalButton: state.showTerminalButton,
      themeMode: state.themeMode,
      themeStyle: state.themeStyle,
    };
    const serialized = JSON.stringify({ state: data, version: 6 });
    localStorage.setItem(DISPLAY_PREFERENCES_STORAGE_KEY, serialized);
    console.log('[theme-store] manual persist done:', data.themeStyle, data.themeMode);
  } catch (e) {
    console.error('[theme-store] manual persist failed:', e);
  }
}

export function useDisplayPreferencesHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => useDisplayPreferencesStore.persist.hasHydrated());

  useEffect(() => {
    const unsub = useDisplayPreferencesStore.persist.onFinishHydration(() => setHydrated(true));
    setHydrated(useDisplayPreferencesStore.persist.hasHydrated());
    return unsub;
  }, []);

  return hydrated;
}
