import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
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
  | 'setShowReasoningBlock'
  | 'setReasoningExpandedByDefault'
  | 'setToolCallsExpandedByDefault'
  | 'setShowComposerStatsBar'
  | 'setShowCommandPaletteButton'
  | 'setShowGatewayStatusIndicator'
  | 'setShowTerminalButton'
  | 'setThemeMode'
  | 'setThemeStyle'
  | 'resetToDefaults'
>;

const DISPLAY_PREFERENCES_STORAGE_KEY = 'openAwork-display-preferences';

const DEFAULTS: DisplayPreferenceValues = {
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
      version: 3,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        showMessageTimestamps: s.showMessageTimestamps,
        showProviderLabel: s.showProviderLabel,
        showModelName: s.showModelName,
        showDuration: s.showDuration,
        showStopReason: s.showStopReason,
        showTokenBreakdown: s.showTokenBreakdown,
        showEstimatedTokens: s.showEstimatedTokens,
        showReasoningBlock: s.showReasoningBlock,
        reasoningExpandedByDefault: s.reasoningExpandedByDefault,
        toolCallsExpandedByDefault: s.toolCallsExpandedByDefault,
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
      showReasoningBlock: state.showReasoningBlock,
      reasoningExpandedByDefault: state.reasoningExpandedByDefault,
      toolCallsExpandedByDefault: state.toolCallsExpandedByDefault,
      showComposerStatsBar: state.showComposerStatsBar,
      showCommandPaletteButton: state.showCommandPaletteButton,
      showGatewayStatusIndicator: state.showGatewayStatusIndicator,
      showTerminalButton: state.showTerminalButton,
      themeMode: state.themeMode,
      themeStyle: state.themeStyle,
    };
    const serialized = JSON.stringify({ state: data, version: 3 });
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
