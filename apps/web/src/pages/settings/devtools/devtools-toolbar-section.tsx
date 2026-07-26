import React from 'react';
import type { DevtoolsSectionId } from './devtools-workbench-primitives.js';
import { SS, BADGE, BP, BS, BG, DIVIDER, TOOLBAR } from '../shared/settings-section-styles.js';

interface DevtoolsToolbarSectionProps {
  anyRefreshableSourceLoading: boolean;
  autoRefreshEnabled: boolean;
  counts: {
    diagnostics: number;
    errorSources: number;
    logs: number;
    sshConnections: number;
    workers: number;
  };
  errorCount: number;
  lastGlobalRefreshAt: number | null;
  workerErrors: number;
  onExportDebugBundle: () => void;
  onExportErrorReport: () => void;
  onExportMarkdownBundle: () => void;
  onRefreshAllSources: () => void;
  onScrollToSection: (sectionId: DevtoolsSectionId) => void;
  onToggleAutoRefresh: () => void;
}

// 导航按钮样式 - 清晰可见
const NAV_BUTTON: React.CSSProperties = {
  borderRadius: 3,
  border: '1px solid var(--border-default)',
  background: 'var(--bg-overlay)',
  padding: '3px 8px',
  color: 'var(--fg-strong)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  fontSize: 11,
  fontWeight: 500,
};

// 活跃导航按钮样式
const NAV_BUTTON_ACTIVE: React.CSSProperties = {
  ...NAV_BUTTON,
  background: 'color-mix(in srgb, var(--accent) 15%, var(--bg-overlay))',
  borderColor: 'color-mix(in srgb, var(--accent) 40%, var(--border-default))',
  color: 'var(--accent)',
  fontWeight: 600,
};

// 导出下拉菜单样式
const EXPORT_DROPDOWN: React.CSSProperties = {
  position: 'relative',
  display: 'inline-block',
};

const EXPORT_MENU: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  right: 0,
  marginTop: 2,
  background: 'var(--bg-overlay)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 3,
  padding: '2px',
  minWidth: 120,
  boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
  zIndex: 10,
};

const EXPORT_ITEM: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '3px 8px',
  border: 'none',
  background: 'transparent',
  color: 'var(--fg-strong)',
  fontSize: 11,
  cursor: 'pointer',
  textAlign: 'left',
  borderRadius: 2,
};

export function DevtoolsToolbarSection({
  anyRefreshableSourceLoading,
  autoRefreshEnabled,
  counts,
  errorCount,
  lastGlobalRefreshAt,
  workerErrors,
  onExportDebugBundle,
  onExportErrorReport,
  onExportMarkdownBundle,
  onRefreshAllSources,
  onScrollToSection,
  onToggleAutoRefresh,
}: DevtoolsToolbarSectionProps) {
  const [showExportMenu, setShowExportMenu] = React.useState(false);
  const exportMenuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const navItems: Array<{
    id: DevtoolsSectionId;
    label: string;
    count?: number;
    isError?: boolean;
  }> = [
    { id: 'overview', label: '总览', count: counts.errorSources, isError: counts.errorSources > 0 },
    {
      id: 'diagnostics',
      label: '诊断',
      count: counts.diagnostics,
      isError: counts.diagnostics > 0,
    },
    { id: 'logs', label: '日志', count: counts.logs },
    { id: 'ssh', label: 'SSH', count: counts.sshConnections },
    { id: 'workers', label: 'Worker', count: workerErrors, isError: workerErrors > 0 },
  ];

  return (
    <section style={{ ...SS, marginBottom: 0, padding: '4px 0' }}>
      <div style={TOOLBAR}>
        {/* 导航标签组 */}
        <div style={{ display: 'flex', gap: 1 }}>
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onScrollToSection(item.id)}
              style={item.isError ? NAV_BUTTON_ACTIVE : NAV_BUTTON}
            >
              {item.label}
              {item.isError && item.count ? (
                <span style={{ ...BADGE, color: 'var(--danger)', fontSize: 9 }}>{item.count}</span>
              ) : null}
            </button>
          ))}
        </div>

        <div style={DIVIDER} />

        {/* 刷新按钮 */}
        <button
          type="button"
          onClick={onRefreshAllSources}
          disabled={anyRefreshableSourceLoading}
          style={{
            ...BG,
            opacity: anyRefreshableSourceLoading ? 0.5 : 1,
            cursor: anyRefreshableSourceLoading ? 'not-allowed' : 'pointer',
          }}
        >
          {anyRefreshableSourceLoading ? '刷新中…' : '刷新'}
        </button>

        {/* 自动刷新切换 */}
        <button
          type="button"
          onClick={onToggleAutoRefresh}
          style={{
            ...BG,
            color: autoRefreshEnabled ? 'var(--accent)' : 'var(--fg-muted)',
            fontWeight: autoRefreshEnabled ? 500 : 400,
          }}
        >
          {autoRefreshEnabled ? '自动' : '手动'}
        </button>

        <div style={DIVIDER} />

        {/* 导出按钮组 */}
        <div style={EXPORT_DROPDOWN} ref={exportMenuRef}>
          <button type="button" onClick={() => setShowExportMenu(!showExportMenu)} style={BP}>
            导出 ▾
          </button>

          {showExportMenu && (
            <div style={EXPORT_MENU}>
              <button
                type="button"
                onClick={() => {
                  onExportErrorReport();
                  setShowExportMenu(false);
                }}
                disabled={errorCount === 0}
                style={{
                  ...EXPORT_ITEM,
                  opacity: errorCount > 0 ? 1 : 0.5,
                  cursor: errorCount > 0 ? 'pointer' : 'not-allowed',
                }}
              >
                错误报告 {errorCount > 0 ? `(${errorCount})` : ''}
              </button>
              <button
                type="button"
                onClick={() => {
                  onExportDebugBundle();
                  setShowExportMenu(false);
                }}
                style={EXPORT_ITEM}
              >
                JSON
              </button>
              <button
                type="button"
                onClick={() => {
                  onExportMarkdownBundle();
                  setShowExportMenu(false);
                }}
                style={EXPORT_ITEM}
              >
                MD
              </button>
            </div>
          )}
        </div>

        {/* 最后刷新时间 */}
        {lastGlobalRefreshAt !== null && (
          <span style={{ fontSize: 10, color: 'var(--fg-muted)', marginLeft: 'auto' }}>
            {new Date(lastGlobalRefreshAt).toLocaleTimeString('zh-CN', { hour12: false })}
          </span>
        )}
      </div>
    </section>
  );
}
