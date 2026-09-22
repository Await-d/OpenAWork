import type { CSSProperties } from 'react';
import {
  SourceOverviewCard,
  subtleButtonInteractionProps,
} from './devtools-workbench-primitives.js';
import type { DevtoolsSourceKey, DevtoolsSourceState } from '../state/settings-types.js';
import { SS, ST } from '../shared/settings-section-styles.js';

interface DevtoolsOverviewSectionProps {
  sourceStates: Record<DevtoolsSourceKey, DevtoolsSourceState>;
  logErrors: number;
  workerErrors: number;
  onRefreshSource: (key: DevtoolsSourceKey) => void;
}

/** 这些数据源没有独立的刷新端点，卡片与错误提示上都不提供重试入口。 */
const NON_REFRESHABLE_SOURCES = new Set<DevtoolsSourceKey>(['githubTriggers', 'providerUpdates']);

const STATUS_STRIP: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '6px 20px',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-overlay)',
  fontSize: 12,
  color: 'var(--fg-muted)',
};

const STATUS_VALUE: CSSProperties = {
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--fg-strong)',
};

const ERROR_CARD: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '4px 10px',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid var(--danger-border)',
  background: 'var(--danger-subtle)',
  fontSize: 12,
};

const SOURCE_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
  gap: 12,
};

const GHOST_INTERACTION = subtleButtonInteractionProps();

function StatusChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'accent' | 'warning' | 'danger';
}) {
  const color =
    tone === 'danger'
      ? 'var(--danger)'
      : tone === 'warning'
        ? 'var(--warning)'
        : tone === 'accent'
          ? 'var(--accent)'
          : undefined;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
      <span>{label}</span>
      <span style={{ ...STATUS_VALUE, ...(color ? { color } : {}) }}>{value}</span>
    </span>
  );
}

export function DevtoolsOverviewSection({
  sourceStates,
  logErrors,
  workerErrors,
  onRefreshSource,
}: DevtoolsOverviewSectionProps) {
  const sources = Object.entries(sourceStates) as Array<[DevtoolsSourceKey, DevtoolsSourceState]>;
  const healthyCount = sources.filter(([, source]) => source.status === 'healthy').length;
  const loadingCount = sources.filter(([, source]) => source.status === 'loading').length;
  const unavailableCount = sources.filter(([, source]) => source.status === 'unavailable').length;
  const emptyCount = sources.filter(([, source]) => source.status === 'empty').length;
  const errorSources = sources.filter(([, source]) => source.status === 'error' && source.error);

  return (
    <section style={SS}>
      <h3 style={ST}>数据源概览</h3>

      <div style={STATUS_STRIP}>
        <StatusChip label="正常" value={healthyCount} tone="accent" />
        <StatusChip label="加载中" value={loadingCount} />
        <StatusChip label="暂无数据" value={emptyCount} />
        <StatusChip label="未接入" value={unavailableCount} tone="warning" />
        <StatusChip label="失败" value={errorSources.length} tone="danger" />
        <StatusChip label="日志错误" value={logErrors} tone="danger" />
        <StatusChip label="Worker 异常" value={workerErrors} tone="danger" />
      </div>

      {errorSources.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {errorSources.map(([key, source]) => (
            <div key={key} style={ERROR_CARD}>
              <span style={{ fontWeight: 600, color: 'var(--danger)', flexShrink: 0 }}>
                {source.label} 加载失败
              </span>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  color: 'var(--fg-default)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={`${source.detail}：${source.error ?? ''}`}
              >
                {source.detail}：{source.error}
              </span>
              {!NON_REFRESHABLE_SOURCES.has(key) && (
                <button
                  type="button"
                  onClick={() => onRefreshSource(key)}
                  {...GHOST_INTERACTION}
                  style={{
                    appearance: 'none',
                    font: 'inherit',
                    fontSize: 12,
                    fontWeight: 500,
                    padding: '4px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--danger-border)',
                    background: 'transparent',
                    color: 'var(--danger)',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  重试
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={SOURCE_GRID}>
        {sources.map(([key, source]) => (
          <SourceOverviewCard
            key={key}
            source={source}
            onRefresh={NON_REFRESHABLE_SOURCES.has(key) ? undefined : () => onRefreshSource(key)}
          />
        ))}
      </div>
    </section>
  );
}
