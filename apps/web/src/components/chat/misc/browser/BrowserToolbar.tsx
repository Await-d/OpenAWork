/**
 * 内置浏览器顶部 chrome：标签栏 + 地址栏（前进/后退/刷新、地址输入、书签、
 * 复制 URL、外部打开、发送到对话、控制台开关）。
 *
 * 从 `BuiltInBrowser.tsx` 抽出，纯 props 驱动——状态与副作用仍由宿主组件持有。
 */

import { useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { BrowserBookmarksDropdown, BrowserTabBar, NavButton } from './browser-chrome.js';
import { TAB_LIMIT, type Bookmark, type BrowserTab } from './browser-storage.js';
import {
  BROWSER_DEVICE_PRESETS,
  DEFAULT_DEVICE_PRESET_ID,
  resolveDevicePreset,
  stepBrowserZoom,
} from './device-presets.js';
import type { BrowserEngineCapability } from './hooks/use-engine-capability.js';
import { browserPreviewShortcutTitle } from './hooks/use-browser-preview-shortcuts.js';

interface BrowserToolbarProps {
  tabs: BrowserTab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onAddTab: () => void;
  /** 标签右键：透传给 tab bar，由宿主渲染菜单。 */
  onTabContextMenu?: (tabId: string, x: number, y: number) => void;

  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onRefresh: () => void;

  addressInput: string;
  onAddressChange: (value: string) => void;
  onAddressKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;

  isCurrentBookmarked: boolean;
  onToggleBookmark: () => void;

  bookmarks: Bookmark[];
  bookmarksOpen: boolean;
  onToggleBookmarks: () => void;
  onCloseBookmarks: () => void;
  onSelectBookmark: (url: string) => void;
  onRemoveBookmark: (id: string) => void;

  onCopyUrl: () => void;
  onOpenExternal: () => void;
  onSendToChat: () => void;
  onNavigate: () => void;

  consoleOpen: boolean;
  onToggleConsole: () => void;
  errorCount: number;
  warnCount: number;

  problemCount: number;
  onSendProblems: () => void;
  capability: BrowserEngineCapability;

  /** 元素拾取是否已武装（仅实时引擎可用时有实际效果）。 */
  pickArmed?: boolean;
  onTogglePick?: () => void;

  /** 设备预设 id（CDP 实时与 iframe 回退共用）。 */
  devicePresetId: string;
  onDevicePresetChange: (id: string) => void;
  /** 纯前端缩放档位（1 = 100%）。 */
  zoom: number;
  onZoomChange: (zoom: number) => void;
  /** Tauri 原生 webview 无法按 CSS 定设备尺寸：隐藏设备条，避免出现无效控件。 */
  devicePreviewEnabled?: boolean;
}

/**
 * 拾取按钮的 title：反映「不可用 / 已武装 / 待武装」三种状态。
 *
 * 拾取器只存在于实时引擎的 DOM 视图里（`CdpLiveEngine`），所以门控必须看
 * `capability.liveView`：同源 iframe 虽然 `domEval` 为真，但没有任何拾取实现，
 * 按 `domEval` 放行会得到一个点了没反应的死按钮。
 */
function resolvePickTitle(capability: BrowserEngineCapability, pickArmed: boolean): string {
  if (!capability.liveView) {
    const reason = capability.limitations[capability.limitations.length - 1];
    return `元素拾取不可用：${reason ?? '需要实时预览（仅 Chromium）'}`;
  }
  return pickArmed
    ? '元素拾取已开启：点击预览中的元素，引用到输入框'
    : '元素拾取：点击后在预览中选择元素';
}

export function BrowserToolbar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onAddTab,
  onTabContextMenu,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onRefresh,
  addressInput,
  onAddressChange,
  onAddressKeyDown,
  isCurrentBookmarked,
  onToggleBookmark,
  bookmarks,
  bookmarksOpen,
  onToggleBookmarks,
  onCloseBookmarks,
  onSelectBookmark,
  onRemoveBookmark,
  onCopyUrl,
  onOpenExternal,
  onSendToChat,
  onNavigate,
  consoleOpen,
  onToggleConsole,
  errorCount,
  warnCount,
  problemCount,
  onSendProblems,
  capability,
  pickArmed = false,
  onTogglePick,
  devicePresetId,
  onDevicePresetChange,
  zoom,
  onZoomChange,
  devicePreviewEnabled = true,
}: BrowserToolbarProps) {
  const [pickHovered, setPickHovered] = useState(false);
  const [pickFocused, setPickFocused] = useState(false);

  return (
    <>
      {/* Tab bar */}
      <BrowserTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
        onAddTab={onAddTab}
        canAddTab={tabs.length < TAB_LIMIT}
        onTabContextMenu={onTabContextMenu}
      />

      {/* Address bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '5px 8px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-overlay)',
          flexShrink: 0,
        }}
      >
        <NavButton
          title="后退"
          disabled={!canGoBack}
          onClick={onBack}
          icon={
            <>
              <polyline points="15 18 9 12 15 6" />
            </>
          }
        />
        <NavButton
          title="前进"
          disabled={!canGoForward}
          onClick={onForward}
          icon={
            <>
              <polyline points="9 18 15 12 9 6" />
            </>
          }
        />
        <NavButton
          title={browserPreviewShortcutTitle('刷新', 'reload')}
          onClick={onRefresh}
          icon={
            <>
              <path d="M21 12a9 9 0 1 1-9-9c2.5 0 4.8 1 6.5 2.6" />
              <path d="M21 3v6h-6" />
            </>
          }
        />
        <input
          type="text"
          value={addressInput}
          onChange={(e) => onAddressChange(e.target.value)}
          onKeyDown={onAddressKeyDown}
          placeholder="输入网址或搜索…"
          style={{
            flex: 1,
            minWidth: 0,
            height: 26,
            padding: '0 10px',
            borderRadius: 13,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-base)',
            color: 'var(--fg-strong)',
            fontSize: 11,
            outline: 'none',
            fontFamily: 'var(--font-mono, monospace)',
            transition: 'border-color 100ms ease, box-shadow 100ms ease',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'var(--accent)';
            e.currentTarget.style.boxShadow = '0 0 0 2px var(--accent-muted)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-subtle)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        />
        <button
          type="button"
          title={isCurrentBookmarked ? '取消收藏' : '收藏当前页'}
          onClick={onToggleBookmark}
          style={{
            width: 26,
            height: 26,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: isCurrentBookmarked
              ? '1px solid color-mix(in oklch, var(--warning) 40%, var(--border-default))'
              : '1px solid var(--border-subtle)',
            borderRadius: 6,
            background: isCurrentBookmarked
              ? 'color-mix(in oklch, var(--warning) 12%, transparent)'
              : 'transparent',
            color: isCurrentBookmarked ? 'var(--warning)' : 'var(--fg-default)',
            cursor: 'pointer',
            flexShrink: 0,
            fontSize: 0,
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill={isCurrentBookmarked ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        </button>
        <BrowserBookmarksDropdown
          bookmarks={bookmarks}
          open={bookmarksOpen}
          onToggle={onToggleBookmarks}
          onClose={onCloseBookmarks}
          onSelect={onSelectBookmark}
          onRemove={onRemoveBookmark}
        />
        <NavButton
          title="复制 URL"
          onClick={onCopyUrl}
          icon={
            <>
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </>
          }
        />
        <NavButton
          title="在系统浏览器中打开"
          onClick={onOpenExternal}
          icon={
            <>
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </>
          }
        />
        <NavButton
          title="发送到对话"
          onClick={onSendToChat}
          icon={
            <>
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </>
          }
        />
        <button
          type="button"
          onClick={onNavigate}
          style={{
            height: 26,
            padding: '0 10px',
            borderRadius: 6,
            border: '1px solid color-mix(in oklch, var(--accent) 30%, var(--border-default))',
            background: 'color-mix(in oklch, var(--accent) 14%, var(--bg-overlay))',
            color: 'var(--accent)',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          前往
        </button>
        <button
          type="button"
          disabled={!capability.liveView}
          aria-pressed={pickArmed}
          onClick={onTogglePick}
          onMouseEnter={() => setPickHovered(true)}
          onMouseLeave={() => setPickHovered(false)}
          onFocus={() => setPickFocused(true)}
          onBlur={() => setPickFocused(false)}
          title={resolvePickTitle(capability, pickArmed)}
          style={{
            width: 26,
            height: 26,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: pickArmed
              ? '1px solid var(--accent)'
              : capability.liveView && (pickHovered || pickFocused)
                ? '1px solid var(--border-emphasis)'
                : '1px solid var(--border-subtle)',
            borderRadius: 6,
            background: pickArmed
              ? 'color-mix(in oklch, var(--accent) 14%, transparent)'
              : 'transparent',
            color: pickArmed
              ? 'var(--accent)'
              : capability.liveView
                ? 'var(--fg-default)'
                : 'var(--fg-subtle)',
            cursor: capability.liveView ? 'pointer' : 'not-allowed',
            flexShrink: 0,
            fontSize: 0,
            opacity: capability.liveView ? 1 : 0.55,
            outline: pickFocused ? '2px solid var(--accent)' : 'none',
            outlineOffset: 2,
            boxShadow: pickFocused
              ? '0 0 0 4px var(--accent-subtle)'
              : pickArmed
                ? '0 0 8px -2px var(--accent)'
                : 'none',
            transition:
              'border-color 100ms cubic-bezier(0.4, 0, 0.2, 1), background 100ms cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="8" />
            <line x1="12" y1="2" x2="12" y2="6" />
            <line x1="12" y1="18" x2="12" y2="22" />
            <line x1="2" y1="12" x2="6" y2="12" />
            <line x1="18" y1="12" x2="22" y2="12" />
          </svg>
        </button>
        <button
          type="button"
          disabled={problemCount === 0}
          onClick={onSendProblems}
          title={
            problemCount > 0
              ? `发送 ${problemCount} 条错误/失败请求到输入框`
              : '暂无可发送的错误或失败请求'
          }
          style={{
            width: 26,
            height: 26,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: problemCount > 0 ? '1px solid var(--danger)' : '1px solid var(--border-subtle)',
            borderRadius: 6,
            background:
              problemCount > 0
                ? 'color-mix(in oklch, var(--danger) 8%, transparent)'
                : 'transparent',
            color: problemCount > 0 ? 'var(--danger)' : 'var(--fg-default)',
            cursor: problemCount > 0 ? 'pointer' : 'not-allowed',
            flexShrink: 0,
            fontSize: 0,
            position: 'relative',
            opacity: problemCount > 0 ? 1 : 0.55,
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          {problemCount > 0 && (
            <span
              style={{
                position: 'absolute',
                top: -3,
                right: -3,
                minWidth: 12,
                height: 12,
                borderRadius: 6,
                background: 'var(--danger)',
                color: 'var(--fg-on-accent)',
                fontSize: 8,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 2px',
              }}
            >
              {problemCount}
            </span>
          )}
        </button>
        {/* Console toggle button */}
        <button
          type="button"
          title={browserPreviewShortcutTitle(
            consoleOpen ? '关闭控制台' : '打开控制台',
            'toggleConsole',
          )}
          onClick={onToggleConsole}
          style={{
            width: 26,
            height: 26,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: consoleOpen
              ? '1px solid var(--accent)'
              : errorCount > 0
                ? '1px solid var(--danger)'
                : '1px solid var(--border-subtle)',
            borderRadius: 6,
            background: consoleOpen
              ? 'color-mix(in oklch, var(--accent) 12%, transparent)'
              : errorCount > 0
                ? 'color-mix(in oklch, var(--danger) 8%, transparent)'
                : 'transparent',
            color:
              errorCount > 0
                ? 'var(--danger)'
                : consoleOpen
                  ? 'var(--accent)'
                  : 'var(--fg-default)',
            cursor: 'pointer',
            flexShrink: 0,
            fontSize: 0,
            position: 'relative',
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M7 15h4" />
            <path d="M7 9l3 3-3 3" />
          </svg>
          {(errorCount > 0 || warnCount > 0) && (
            <span
              style={{
                position: 'absolute',
                top: -3,
                right: -3,
                minWidth: 12,
                height: 12,
                borderRadius: 6,
                background: errorCount > 0 ? 'var(--danger)' : 'var(--warning)',
                color: 'var(--fg-on-accent)',
                fontSize: 8,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 2px',
              }}
            >
              {errorCount || warnCount}
            </span>
          )}
        </button>
      </div>

      {devicePreviewEnabled && (
        <DevicePreviewBar
          devicePresetId={devicePresetId}
          onDevicePresetChange={onDevicePresetChange}
          zoom={zoom}
          onZoomChange={onZoomChange}
        />
      )}
    </>
  );
}

const DEVICE_BAR_LABEL_STYLE: CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--fg-subtle)',
  flexShrink: 0,
};

const DEVICE_BAR_READOUT_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  height: 22,
  padding: '0 6px',
  borderRadius: 'var(--radius-xs)',
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)',
  color: 'var(--fg-muted)',
  fontSize: 10.5,
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

interface DeviceBarButtonProps {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}

/** 设备条上的小按钮：hover / active / focus / disabled 与地址栏控件共用同一套 token。 */
function DeviceBarButton({ title, disabled = false, onClick, children }: DeviceBarButtonProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const interactive = !disabled;

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        minWidth: 22,
        height: 22,
        padding: '0 6px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        border:
          hovered && interactive
            ? '1px solid var(--border-emphasis)'
            : '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-xs)',
        background:
          pressed && interactive
            ? 'color-mix(in oklch, var(--accent) 16%, transparent)'
            : hovered && interactive
              ? 'color-mix(in oklch, var(--accent) 8%, transparent)'
              : 'transparent',
        color: disabled ? 'var(--fg-subtle)' : 'var(--fg-default)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        transform: pressed && interactive ? 'translateY(1px)' : undefined,
        flexShrink: 0,
        fontSize: 10.5,
        fontWeight: 600,
        outline: focused ? '2px solid var(--accent)' : 'none',
        outlineOffset: 2,
        boxShadow: focused ? '0 0 0 4px var(--accent-subtle)' : 'none',
        transition:
          'border-color 100ms cubic-bezier(0.4, 0, 0.2, 1), background 100ms cubic-bezier(0.4, 0, 0.2, 1), transform 100ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      {children}
    </button>
  );
}

interface DevicePreviewBarProps {
  devicePresetId: string;
  onDevicePresetChange: (id: string) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
}

/**
 * 设备预设 / 缩放控制条：预设决定模拟视口（CDP 下发 `device`，iframe 用 CSS 定尺寸），
 * 缩放是纯前端 CSS 变换。始终展示当前预设与模拟尺寸。
 */
function DevicePreviewBar({
  devicePresetId,
  onDevicePresetChange,
  zoom,
  onZoomChange,
}: DevicePreviewBarProps) {
  const [presetHovered, setPresetHovered] = useState(false);
  const [presetFocused, setPresetFocused] = useState(false);

  const preset = resolveDevicePreset(devicePresetId);
  const viewport = preset !== null && preset.width > 0 && preset.height > 0 ? preset : null;
  const zoomed = zoom !== 1;

  return (
    <div
      data-testid="browser-device-bar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-overlay)',
        flexShrink: 0,
        overflowX: 'auto',
        scrollbarWidth: 'thin',
      }}
    >
      <span style={DEVICE_BAR_LABEL_STYLE}>设备</span>
      <select
        aria-label="设备预设"
        title={browserPreviewShortcutTitle('设备预设：模拟目标设备的视口尺寸', 'cycleDevicePreset')}
        value={preset?.id ?? DEFAULT_DEVICE_PRESET_ID}
        onChange={(event) => onDevicePresetChange(event.target.value)}
        onMouseEnter={() => setPresetHovered(true)}
        onMouseLeave={() => setPresetHovered(false)}
        onFocus={() => setPresetFocused(true)}
        onBlur={() => setPresetFocused(false)}
        style={{
          height: 22,
          padding: '0 4px',
          borderRadius: 'var(--radius-xs)',
          border:
            presetHovered || presetFocused
              ? '1px solid var(--border-emphasis)'
              : '1px solid var(--border-subtle)',
          background: 'var(--bg-base)',
          color: 'var(--fg-default)',
          fontSize: 10.5,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        {BROWSER_DEVICE_PRESETS.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
      <span data-testid="browser-device-size" style={DEVICE_BAR_READOUT_STYLE}>
        {viewport !== null ? `${viewport.width}×${viewport.height}` : '填充面板'}
      </span>

      <div style={{ flex: 1 }} />

      <span style={DEVICE_BAR_LABEL_STYLE}>缩放</span>
      <DeviceBarButton
        title={browserPreviewShortcutTitle('缩小', 'zoomOut')}
        disabled={stepBrowserZoom(zoom, 'out') === zoom}
        onClick={() => onZoomChange(stepBrowserZoom(zoom, 'out'))}
      >
        −
      </DeviceBarButton>
      <span
        data-testid="browser-zoom-readout"
        style={{
          ...DEVICE_BAR_READOUT_STYLE,
          border: zoomed ? '1px solid var(--accent-border)' : '1px solid var(--border-subtle)',
          color: zoomed ? 'var(--accent)' : 'var(--fg-muted)',
          fontWeight: zoomed ? 600 : 500,
        }}
      >
        {Math.round(zoom * 100)}%
      </span>
      <DeviceBarButton
        title={browserPreviewShortcutTitle('放大', 'zoomIn')}
        disabled={stepBrowserZoom(zoom, 'in') === zoom}
        onClick={() => onZoomChange(stepBrowserZoom(zoom, 'in'))}
      >
        +
      </DeviceBarButton>
      <DeviceBarButton
        title={browserPreviewShortcutTitle('重置缩放为 100%', 'zoomReset')}
        disabled={!zoomed}
        onClick={() => onZoomChange(1)}
      >
        1:1
      </DeviceBarButton>
    </div>
  );
}
