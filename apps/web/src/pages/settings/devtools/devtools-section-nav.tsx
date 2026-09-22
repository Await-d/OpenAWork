import React from 'react';
import type { CSSProperties } from 'react';
import { SettingsToggle } from '../shared/settings-toggle.js';
import {
  SOLID_BUTTON_INTERACTION,
  subtleButtonInteractionProps,
} from './devtools-workbench-primitives.js';

export type DevtoolsSectionId = 'overview' | 'diagnostics' | 'logs' | 'workers';

export interface DevtoolsSectionNavItem {
  id: DevtoolsSectionId;
  label: string;
  /** 该分区的条目计数；仅用于 badge 展示，0 时显示为 0。 */
  count: number;
  /** 分区内存在需要关注的异常（badge 用语义色提示，不代表当前选中）。 */
  hasError: boolean;
}

interface DevtoolsSectionNavProps {
  activeSection: DevtoolsSectionId;
  items: readonly DevtoolsSectionNavItem[];
  anyRefreshableSourceLoading: boolean;
  autoRefreshEnabled: boolean;
  lastGlobalRefreshAt: number | null;
  /** 待排查问题合计（诊断 + 错误日志 + Worker 异常），仅用于按钮计数展示。 */
  issueCount: number;
  onSelectSection: (section: DevtoolsSectionId) => void;
  onRefreshAllSources: () => void;
  onToggleAutoRefresh: (enabled: boolean) => void;
  /** 复制完整排障上下文（Markdown）；resolve 为是否写入成功。 */
  onCopyTroubleshootBundle: () => Promise<boolean>;
  onExportErrorReport: () => void;
  onExportDebugBundle: () => void;
  onExportMarkdownBundle: () => void;
}

const NAV_CARD: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 12,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-overlay)',
};

const TAB_GROUP: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
};

const TAB_BASE: CSSProperties = {
  appearance: 'none',
  font: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  fontWeight: 500,
  lineHeight: 1.4,
  padding: '6px 12px',
  borderRadius: 999,
  border: '1px solid var(--border-default)',
  background: 'transparent',
  color: 'var(--fg-default)',
  cursor: 'pointer',
  transition: 'background 150ms ease, border-color 150ms ease, color 150ms ease',
};

const TAB_SELECTED: CSSProperties = {
  background: 'var(--accent)',
  border: '1px solid var(--accent)',
  color: 'var(--fg-on-accent)',
  fontWeight: 600,
};

const COUNT_BADGE: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
  lineHeight: '16px',
  padding: '0 6px',
  borderRadius: 999,
  background: 'var(--bg-raised)',
  color: 'var(--fg-muted)',
};

const ACTION_ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 10,
  minWidth: 0,
};

const SECONDARY_BUTTON: CSSProperties = {
  appearance: 'none',
  font: 'inherit',
  fontSize: 12,
  fontWeight: 500,
  lineHeight: 1.4,
  padding: '6px 12px',
  borderRadius: 6,
  border: '1px solid var(--border-default)',
  background: 'transparent',
  color: 'var(--fg-default)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  transition: 'background 150ms ease, border-color 150ms ease, color 150ms ease',
};

const PRIMARY_BUTTON: CSSProperties = {
  ...SECONDARY_BUTTON,
  background: 'var(--accent)',
  border: '1px solid var(--accent)',
  color: 'var(--fg-on-accent)',
  fontWeight: 600,
};

const EXPORT_MENU: CSSProperties = {
  position: 'absolute',
  top: '100%',
  right: 0,
  marginTop: 6,
  minWidth: 168,
  padding: 4,
  borderRadius: 8,
  border: '1px solid var(--border-default)',
  background: 'var(--bg-raised)',
  boxShadow: 'var(--shadow-md)',
  zIndex: 20,
};

const EXPORT_ITEM: CSSProperties = {
  appearance: 'none',
  display: 'block',
  width: '100%',
  padding: '7px 10px',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--fg-default)',
  font: 'inherit',
  fontSize: 12,
  textAlign: 'left',
  cursor: 'pointer',
  transition: 'background 120ms ease',
};

const AUTO_REFRESH_LABEL: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
  color: 'var(--fg-default)',
  whiteSpace: 'nowrap',
};

const LAST_REFRESH: CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-muted)',
  whiteSpace: 'nowrap',
};

const GHOST_INTERACTION = subtleButtonInteractionProps();

function formatRefreshTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false });
}

/**
 * devtools 分区导航 + 页面级操作。
 *
 * 「总览 / 诊断 / 日志 / Worker / SSH」是真正的分区切换（一次只渲染一个分区），
 * 不再用 scrollIntoView 在长页里做定位；badge 的语义色只表达「该分区有异常」，
 * 与「当前选中」解耦，避免过去「有错误 = 看起来像选中」的歧义。
 */
export function DevtoolsSectionNav({
  activeSection,
  items,
  anyRefreshableSourceLoading,
  autoRefreshEnabled,
  lastGlobalRefreshAt,
  issueCount,
  onSelectSection,
  onRefreshAllSources,
  onToggleAutoRefresh,
  onCopyTroubleshootBundle,
  onExportErrorReport,
  onExportDebugBundle,
  onExportMarkdownBundle,
}: DevtoolsSectionNavProps) {
  const [hoveredTab, setHoveredTab] = React.useState<DevtoolsSectionId | null>(null);
  const [focusedTab, setFocusedTab] = React.useState<DevtoolsSectionId | null>(null);
  const [showExportMenu, setShowExportMenu] = React.useState(false);
  const [bundleCopyState, setBundleCopyState] = React.useState<'idle' | 'copied' | 'failed'>(
    'idle',
  );
  const exportMenuRef = React.useRef<HTMLDivElement>(null);
  const bundleCopyTimeoutRef = React.useRef<number | null>(null);

  React.useEffect(
    () => () => {
      if (bundleCopyTimeoutRef.current !== null) {
        window.clearTimeout(bundleCopyTimeoutRef.current);
      }
    },
    [],
  );

  const handleCopyTroubleshootBundle = () => {
    void onCopyTroubleshootBundle().then((ok) => {
      setBundleCopyState(ok ? 'copied' : 'failed');
      if (bundleCopyTimeoutRef.current !== null) {
        window.clearTimeout(bundleCopyTimeoutRef.current);
      }
      bundleCopyTimeoutRef.current = window.setTimeout(() => setBundleCopyState('idle'), 2600);
    });
  };

  React.useEffect(() => {
    if (!showExportMenu) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setShowExportMenu(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowExportMenu(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showExportMenu]);

  return (
    <div style={NAV_CARD}>
      <div role="group" aria-label="开发者工具分区" style={TAB_GROUP}>
        {items.map((item) => {
          const isSelected = item.id === activeSection;
          const isHovered = hoveredTab === item.id && !isSelected;
          const isFocused = focusedTab === item.id;

          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelectSection(item.id)}
              onMouseEnter={() => setHoveredTab(item.id)}
              onMouseLeave={() => setHoveredTab(null)}
              onFocus={() => setFocusedTab(item.id)}
              onBlur={() => setFocusedTab(null)}
              style={{
                ...TAB_BASE,
                ...(isSelected ? TAB_SELECTED : {}),
                ...(isHovered
                  ? {
                      background: 'var(--bg-hover)',
                      border: '1px solid var(--border-emphasis)',
                    }
                  : {}),
                outline: isFocused ? '2px solid var(--accent)' : 'none',
                outlineOffset: 2,
              }}
            >
              {item.label}
              <span
                style={{
                  ...COUNT_BADGE,
                  ...(isSelected
                    ? {
                        background: 'color-mix(in srgb, var(--fg-on-accent) 20%, transparent)',
                        color: 'var(--fg-on-accent)',
                      }
                    : {}),
                  ...(item.hasError && !isSelected ? { color: 'var(--danger)' } : {}),
                }}
              >
                {item.count}
              </span>
            </button>
          );
        })}
      </div>

      <div style={ACTION_ROW}>
        <button
          type="button"
          onClick={onRefreshAllSources}
          disabled={anyRefreshableSourceLoading}
          {...GHOST_INTERACTION}
          style={{
            ...SECONDARY_BUTTON,
            opacity: anyRefreshableSourceLoading ? 0.5 : 1,
            cursor: anyRefreshableSourceLoading ? 'not-allowed' : 'pointer',
          }}
        >
          {anyRefreshableSourceLoading ? '刷新中…' : '刷新全部'}
        </button>

        <label style={AUTO_REFRESH_LABEL} title="开启后每 30 秒自动刷新全部数据源">
          <SettingsToggle
            checked={autoRefreshEnabled}
            onChange={onToggleAutoRefresh}
            ariaLabel="自动刷新全部数据源（每 30 秒）"
          />
          自动刷新
        </label>

        <span
          aria-live="polite"
          style={{
            fontSize: 11,
            whiteSpace: 'nowrap',
            color: bundleCopyState === 'failed' ? 'var(--danger)' : 'var(--accent)',
          }}
        >
          {bundleCopyState === 'copied'
            ? '已复制，可直接粘贴给 AI'
            : bundleCopyState === 'failed'
              ? '复制失败：浏览器拒绝了剪贴板写入'
              : ''}
        </span>

        <button
          type="button"
          onClick={handleCopyTroubleshootBundle}
          title="一次性复制环境信息、全部诊断、全部错误日志与 Worker 异常（Markdown）"
          {...SOLID_BUTTON_INTERACTION}
          style={PRIMARY_BUTTON}
        >
          复制排障上下文{issueCount > 0 ? ` (${issueCount})` : ''}
        </button>

        <div style={{ position: 'relative' }} ref={exportMenuRef}>
          <button
            type="button"
            onClick={() => setShowExportMenu((prev) => !prev)}
            aria-haspopup="menu"
            aria-expanded={showExportMenu}
            {...GHOST_INTERACTION}
            style={SECONDARY_BUTTON}
          >
            导出 ▾
          </button>

          {showExportMenu && (
            <div role="menu" style={EXPORT_MENU}>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onExportErrorReport();
                  setShowExportMenu(false);
                }}
                {...GHOST_INTERACTION}
                style={EXPORT_ITEM}
              >
                错误报告 (HTML)
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onExportDebugBundle();
                  setShowExportMenu(false);
                }}
                {...GHOST_INTERACTION}
                style={EXPORT_ITEM}
              >
                调试包 (JSON)
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onExportMarkdownBundle();
                  setShowExportMenu(false);
                }}
                {...GHOST_INTERACTION}
                style={EXPORT_ITEM}
              >
                调试包 (Markdown)
              </button>
            </div>
          )}
        </div>

        {lastGlobalRefreshAt !== null && (
          <span style={LAST_REFRESH}>最后刷新 {formatRefreshTime(lastGlobalRefreshAt)}</span>
        )}
      </div>
    </div>
  );
}
