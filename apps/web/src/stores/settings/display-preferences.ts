import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * 主题模式。
 * - `system`：跟随系统 prefers-color-scheme
 * - `light`：强制浅色
 * - `dark`：强制深色
 */
export type ThemeMode = 'system' | 'light' | 'dark';

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

  // ── 推理与工具调用 ────────────────────────────────────────

  showReasoningBlock: boolean;
  setShowReasoningBlock: (v: boolean) => void;

  reasoningExpandedByDefault: boolean;
  setReasoningExpandedByDefault: (v: boolean) => void;

  toolCallsExpandedByDefault: boolean;
  setToolCallsExpandedByDefault: (v: boolean) => void;

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

  /** 重置全部为默认值 */
  resetToDefaults: () => void;
}

const DEFAULTS = {
  showMessageTimestamps: true,
  showProviderLabel: true,
  showModelName: true,
  showDuration: true,
  showStopReason: true,
  showTokenBreakdown: true,
  showEstimatedTokens: true,
  showReasoningBlock: true,
  reasoningExpandedByDefault: false,
  toolCallsExpandedByDefault: false,
  showComposerStatsBar: true,
  showCommandPaletteButton: true,
  showGatewayStatusIndicator: true,
  showTerminalButton: true,
  themeMode: 'system' as ThemeMode,
} as const;

export const useDisplayPreferencesStore = create<DisplayPreferencesStore>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setShowMessageTimestamps: (v) => set({ showMessageTimestamps: v }),
      setShowProviderLabel: (v) => set({ showProviderLabel: v }),
      setShowModelName: (v) => set({ showModelName: v }),
      setShowDuration: (v) => set({ showDuration: v }),
      setShowStopReason: (v) => set({ showStopReason: v }),
      setShowTokenBreakdown: (v) => set({ showTokenBreakdown: v }),
      setShowEstimatedTokens: (v) => set({ showEstimatedTokens: v }),
      setShowReasoningBlock: (v) => set({ showReasoningBlock: v }),
      setReasoningExpandedByDefault: (v) => set({ reasoningExpandedByDefault: v }),
      setToolCallsExpandedByDefault: (v) => set({ toolCallsExpandedByDefault: v }),
      setShowComposerStatsBar: (v) => set({ showComposerStatsBar: v }),
      setShowCommandPaletteButton: (v) => set({ showCommandPaletteButton: v }),
      setShowGatewayStatusIndicator: (v) => set({ showGatewayStatusIndicator: v }),
      setShowTerminalButton: (v) => set({ showTerminalButton: v }),
      setThemeMode: (v) => set({ themeMode: v }),
      resetToDefaults: () => set({ ...DEFAULTS }),
    }),
    {
      name: 'openAwork-display-preferences',
      version: 1,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
