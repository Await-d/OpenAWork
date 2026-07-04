import React from 'react';
import type { DevtoolsSectionId } from './devtools-workbench-primitives.js';
import { SS } from '../shared/settings-section-styles.js';

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

const DANGER_BADGE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 16,
  height: 16,
  borderRadius: 999,
  background: 'var(--danger)',
  color: 'var(--fg-on-accent)',
  fontSize: 9,
  fontWeight: 800,
  padding: '0 4px',
  marginLeft: 4,
  lineHeight: 1,
};

const WARNING_BADGE: React.CSSProperties = {
  ...DANGER_BADGE,
  background: 'var(--warning)',
  color: 'var(--bg-base)',
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
  return (
    <section
      style={{
        ...SS,
        padding: '0.5rem 0.75rem',
        borderBottom: '2px solid var(--accent)',
      }}
    >
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--fg-muted)',
            marginRight: 4,
            flexShrink: 0,
          }}
        >
          跳转
        </span>
        <button
          type="button"
          onClick={() => onScrollToSection('overview')}
          style={{
            borderRadius: 8,
            border: '1px solid var(--border-default)',
            background: 'color-mix(in srgb, var(--bg-overlay) 92%, var(--bg-base))',
            padding: '7px 10px',
            color: 'var(--fg-strong)',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            minWidth: 100,
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 700 }}>总览</span>
          {counts.errorSources > 0 ? (
            <span style={WARNING_BADGE}>{counts.errorSources}</span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => onScrollToSection('diagnostics')}
          style={{
            borderRadius: 8,
            border:
              counts.diagnostics > 0
                ? '1px solid color-mix(in srgb, var(--danger) 40%, var(--border-default))'
                : '1px solid var(--border-default)',
            borderLeft:
              counts.diagnostics > 0
                ? '3px solid var(--danger)'
                : '1px solid var(--border-default)',
            background: 'color-mix(in srgb, var(--bg-overlay) 92%, var(--bg-base))',
            padding: '7px 10px',
            color: 'var(--fg-strong)',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            minWidth: 100,
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 700 }}>诊断</span>
          {counts.diagnostics > 0 ? <span style={DANGER_BADGE}>{counts.diagnostics}</span> : null}
        </button>
        <button
          type="button"
          onClick={() => onScrollToSection('logs')}
          style={{
            borderRadius: 8,
            border: '1px solid var(--border-default)',
            background: 'color-mix(in srgb, var(--bg-overlay) 92%, var(--bg-base))',
            padding: '7px 10px',
            color: 'var(--fg-strong)',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            minWidth: 100,
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 700 }}>日志</span>
          <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>{counts.logs} 条可见日志</span>
        </button>
        <button
          type="button"
          onClick={() => onScrollToSection('ssh')}
          style={{
            borderRadius: 8,
            border: '1px solid var(--border-default)',
            background: 'color-mix(in srgb, var(--bg-overlay) 92%, var(--bg-base))',
            padding: '7px 10px',
            color: 'var(--fg-strong)',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            minWidth: 100,
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 700 }}>SSH</span>
          {counts.sshConnections > 0 ? (
            <span
              style={{
                fontSize: 10,
                color: 'var(--fg-muted)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {counts.sshConnections}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => onScrollToSection('workers')}
          style={{
            borderRadius: 8,
            border: '1px solid var(--border-default)',
            background: 'color-mix(in srgb, var(--bg-overlay) 92%, var(--bg-base))',
            padding: '7px 10px',
            color: 'var(--fg-strong)',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            minWidth: 100,
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 700 }}>Worker</span>
          {workerErrors > 0 ? <span style={DANGER_BADGE}>{workerErrors}</span> : null}
        </button>
        <div
          style={{
            width: 1,
            height: 20,
            background: 'var(--border-default)',
            flexShrink: 0,
            margin: '0 2px',
          }}
        />
        <button
          type="button"
          onClick={onRefreshAllSources}
          disabled={anyRefreshableSourceLoading}
          aria-label="刷新全部数据源"
          style={{
            borderRadius: 8,
            border: '1px solid var(--border-default)',
            padding: '5px 8px',
            background: 'var(--bg-overlay)',
            color: anyRefreshableSourceLoading ? 'var(--fg-muted)' : 'var(--fg-strong)',
            fontSize: 10,
            cursor: anyRefreshableSourceLoading ? 'not-allowed' : 'pointer',
            opacity: anyRefreshableSourceLoading ? 0.55 : 1,
          }}
        >
          {anyRefreshableSourceLoading ? '刷新中…' : '刷新'}
        </button>
        <button
          type="button"
          onClick={onToggleAutoRefresh}
          style={{
            borderRadius: 8,
            border: `1px solid ${
              autoRefreshEnabled
                ? 'color-mix(in srgb, var(--accent) 30%, var(--border-default))'
                : 'var(--border-default)'
            }`,
            padding: '5px 8px',
            background: autoRefreshEnabled
              ? 'color-mix(in srgb, var(--accent) 8%, var(--bg-overlay))'
              : 'var(--bg-overlay)',
            color: autoRefreshEnabled ? 'var(--accent)' : 'var(--fg-muted)',
            fontSize: 10,
            fontWeight: autoRefreshEnabled ? 700 : 400,
            cursor: 'pointer',
          }}
        >
          自动 {autoRefreshEnabled ? '开' : '关'}
        </button>
        <div
          style={{
            width: 1,
            height: 20,
            background: 'var(--border-default)',
            flexShrink: 0,
            margin: '0 2px',
          }}
        />
        <button
          type="button"
          onClick={onExportErrorReport}
          disabled={errorCount === 0}
          style={{
            borderRadius: 8,
            border: errorCount > 0 ? '2px solid var(--danger)' : '1px solid var(--border-default)',
            padding: '5px 10px',
            background: errorCount > 0 ? 'var(--danger)' : 'var(--bg-overlay)',
            color: errorCount > 0 ? 'var(--fg-on-accent)' : 'var(--fg-muted)',
            fontSize: 10,
            fontWeight: 700,
            cursor: errorCount > 0 ? 'pointer' : 'not-allowed',
            opacity: errorCount > 0 ? 1 : 0.5,
            whiteSpace: 'nowrap',
          }}
          title={
            errorCount > 0 ? `导出包含 ${errorCount} 条错误的完整 HTML 报告` : '当前无错误可导出'
          }
        >
          导出错误报告{errorCount > 0 ? ` (${errorCount})` : ''}
        </button>
        <button
          type="button"
          onClick={onExportDebugBundle}
          style={{
            borderRadius: 8,
            border: '1px solid var(--accent)',
            padding: '5px 8px',
            background: 'var(--accent)',
            color: 'var(--fg-on-accent)',
            fontSize: 10,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          导出 JSON
        </button>
        <button
          type="button"
          onClick={onExportMarkdownBundle}
          style={{
            borderRadius: 8,
            border: '1px solid color-mix(in srgb, var(--accent) 28%, var(--border-default))',
            padding: '5px 8px',
            background: 'var(--bg-overlay)',
            color: 'var(--fg-strong)',
            fontSize: 10,
            cursor: 'pointer',
          }}
        >
          导出 MD
        </button>
        {lastGlobalRefreshAt !== null ? (
          <span
            style={{
              fontSize: 10,
              color: 'var(--fg-muted)',
              fontVariantNumeric: 'tabular-nums',
              marginLeft: 4,
              whiteSpace: 'nowrap',
            }}
          >
            最后刷新 {new Date(lastGlobalRefreshAt).toLocaleTimeString('zh-CN', { hour12: false })}
          </span>
        ) : null}
      </div>
    </section>
  );
}
