import type { CSSProperties } from 'react';
import { SegmentedToggle } from '../../shared/content-kit/index.js';
import { TeamTabIcon } from '../team-tab-icons.js';

export type MetricsMode = 'usage' | 'tools';

export interface TeamMetricsWorkbenchHeaderProps {
  readonly mode: MetricsMode;
  readonly onModeChange: (mode: MetricsMode) => void;
  readonly scopeLabel: string;
  readonly callCountLabel: string;
  readonly totalTokensLabel: string;
  readonly costLabel: string;
  readonly toolCallsLabel: string;
  readonly toolFailuresLabel: string;
  readonly providerCountLabel: string;
  readonly recentCountLabel: string;
  readonly sharedSnapshot: boolean;
}

const HEADER_STYLE: CSSProperties = {
  display: 'grid',
  gap: 12,
  padding: '14px 16px',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 34%, transparent)',
  background:
    'linear-gradient(180deg, color-mix(in oklch, var(--bg-overlay) 92%, var(--aux) 5%), var(--bg-base))',
};

const HERO_ROW_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto minmax(0, 1fr) auto',
  gap: 12,
  alignItems: 'start',
};

const ICON_FRAME_STYLE: CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 10,
  display: 'grid',
  placeItems: 'center',
  border: '1px solid var(--aux-border)',
  background: 'var(--aux-subtle)',
  color: 'var(--aux)',
};

const EYEBROW_STYLE: CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  color: 'var(--fg-muted)',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

const TITLE_STYLE: CSSProperties = {
  fontSize: 16,
  fontWeight: 800,
  color: 'var(--fg-strong)',
  lineHeight: 1.25,
  wordBreak: 'keep-all',
};

const DESCRIPTION_STYLE: CSSProperties = {
  fontSize: 11.5,
  lineHeight: 1.55,
  color: 'var(--fg-muted)',
  wordBreak: 'keep-all',
  textWrap: 'pretty',
};

const SUMMARY_GRID_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(116px, 1fr))',
  gap: 8,
};

const SUMMARY_CARD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 3,
  minWidth: 0,
  padding: '9px 10px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border-default) 48%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 78%, var(--bg-base))',
};

const SUMMARY_LABEL_STYLE: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: 'var(--fg-muted)',
  whiteSpace: 'nowrap',
};

const SUMMARY_VALUE_STYLE: CSSProperties = {
  fontSize: 18,
  fontWeight: 800,
  lineHeight: 1.05,
  fontVariantNumeric: 'tabular-nums',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const SIGNAL_ROW_STYLE: CSSProperties = {
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
  alignItems: 'center',
};

function SummaryCard({
  color = 'var(--fg-strong)',
  label,
  value,
}: {
  readonly color?: string;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div style={SUMMARY_CARD_STYLE}>
      <span style={SUMMARY_LABEL_STYLE}>{label}</span>
      <span style={{ ...SUMMARY_VALUE_STYLE, color }} title={value}>
        {value}
      </span>
    </div>
  );
}

function ScopeSignal({ label, tone }: { readonly label: string; readonly tone: 'aux' | 'accent' }) {
  const color = tone === 'aux' ? 'var(--aux)' : 'var(--accent)';
  return (
    <span
      style={{
        minHeight: 22,
        padding: '0 8px',
        borderRadius: 999,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        border: '1px solid color-mix(in srgb, currentColor 28%, transparent)',
        background: 'color-mix(in srgb, currentColor 9%, var(--bg-overlay))',
        color,
        fontSize: 10.5,
        fontWeight: 700,
      }}
    >
      <TeamTabIcon name={tone === 'aux' ? 'shares' : 'metrics'} size={11} />
      <span>{label}</span>
    </span>
  );
}

export function TeamMetricsWorkbenchHeader({
  mode,
  onModeChange,
  scopeLabel,
  callCountLabel,
  totalTokensLabel,
  costLabel,
  toolCallsLabel,
  toolFailuresLabel,
  providerCountLabel,
  recentCountLabel,
  sharedSnapshot,
}: TeamMetricsWorkbenchHeaderProps) {
  return (
    <section aria-label="度量工作台摘要" style={HEADER_STYLE}>
      <div style={HERO_ROW_STYLE}>
        <span style={ICON_FRAME_STYLE}>
          <TeamTabIcon name="metrics" size={18} />
        </span>
        <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
          <span style={EYEBROW_STYLE}>Team metrics</span>
          <span style={TITLE_STYLE}>度量成本面板</span>
          <span style={DESCRIPTION_STYLE}>
            汇总用量、成本、工具调用和失败信号，让运行成本与编排效率先进入视线。
          </span>
        </div>
        <SegmentedToggle<MetricsMode>
          ariaLabel="度量视图切换"
          size="sm"
          value={mode}
          onChange={onModeChange}
          options={[
            { value: 'usage', label: '用量 & 费用', icon: <TeamTabIcon name="usage" /> },
            { value: 'tools', label: '工具调用', icon: <TeamTabIcon name="settings" /> },
          ]}
        />
      </div>

      <div style={SUMMARY_GRID_STYLE}>
        <SummaryCard label="统计范围" value={scopeLabel} color="var(--fg-strong)" />
        <SummaryCard label="LLM 调用" value={callCountLabel} color="var(--accent)" />
        <SummaryCard label="总 token" value={totalTokensLabel} color="var(--aux)" />
        <SummaryCard label="估算成本" value={costLabel} color="var(--warning)" />
        <SummaryCard label="工具调用" value={toolCallsLabel} color="var(--fg-strong)" />
        <SummaryCard label="失败数" value={toolFailuresLabel} color="var(--danger)" />
      </div>

      <div style={SIGNAL_ROW_STYLE}>
        <ScopeSignal label={sharedSnapshot ? '共享会话快照' : '本地运行时聚合'} tone="aux" />
        <ScopeSignal label={`Provider ${providerCountLabel}`} tone="accent" />
        <ScopeSignal label={`最近调用 ${recentCountLabel}`} tone="accent" />
      </div>
    </section>
  );
}
