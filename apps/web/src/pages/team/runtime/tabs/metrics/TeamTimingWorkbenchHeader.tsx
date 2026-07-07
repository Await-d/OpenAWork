import type { CSSProperties } from 'react';
import { TeamTabIcon } from '../team-tab-icons.js';

export interface TeamTimingWorkbenchHeaderProps {
  readonly scopeLabel: string;
  readonly handoffCountLabel: string;
  readonly runningCountLabel: string;
  readonly successRateLabel: string;
  readonly completedSampleLabel: string;
  readonly p50Label: string;
  readonly p95Label: string;
  readonly sharedSnapshot: boolean;
}

const HEADER_STYLE: CSSProperties = {
  display: 'grid',
  gap: 12,
  padding: '14px 16px',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 34%, transparent)',
  background:
    'linear-gradient(180deg, color-mix(in oklch, var(--bg-overlay) 92%, var(--contrast) 5%), var(--bg-base))',
};

const HERO_ROW_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto minmax(0, 1fr)',
  gap: 12,
  alignItems: 'start',
};

const ICON_FRAME_STYLE: CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 10,
  display: 'grid',
  placeItems: 'center',
  border: '1px solid var(--contrast-border)',
  background: 'var(--contrast-subtle)',
  color: 'var(--contrast)',
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

function TimingSignal({
  label,
  tone,
}: {
  readonly label: string;
  readonly tone: 'contrast' | 'aux';
}) {
  const color = tone === 'contrast' ? 'var(--contrast)' : 'var(--aux)';
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
      <TeamTabIcon name={tone === 'contrast' ? 'timing' : 'shares'} size={11} />
      <span>{label}</span>
    </span>
  );
}

export function TeamTimingWorkbenchHeader({
  scopeLabel,
  handoffCountLabel,
  runningCountLabel,
  successRateLabel,
  completedSampleLabel,
  p50Label,
  p95Label,
  sharedSnapshot,
}: TeamTimingWorkbenchHeaderProps) {
  return (
    <section aria-label="耗时工作台摘要" style={HEADER_STYLE}>
      <div style={HERO_ROW_STYLE}>
        <span style={ICON_FRAME_STYLE}>
          <TeamTabIcon name="timing" size={18} />
        </span>
        <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
          <span style={EYEBROW_STYLE}>Team timing</span>
          <span style={TITLE_STYLE}>耗时节奏面板</span>
          <span style={DESCRIPTION_STYLE}>
            汇总 handoff 规模、实时运行、成功率和分位耗时，让团队节奏先于明细进入视线。
          </span>
        </div>
      </div>

      <div style={SUMMARY_GRID_STYLE}>
        <SummaryCard label="统计范围" value={scopeLabel} color="var(--fg-strong)" />
        <SummaryCard label="Handoff 总数" value={handoffCountLabel} color="var(--contrast)" />
        <SummaryCard label="运行中" value={runningCountLabel} color="var(--success)" />
        <SummaryCard label="成功率" value={successRateLabel} color="var(--accent)" />
        <SummaryCard label="已结束样本" value={completedSampleLabel} color="var(--fg-strong)" />
        <SummaryCard label="P50 / P95" value={`${p50Label} / ${p95Label}`} color="var(--aux)" />
      </div>

      <div style={SIGNAL_ROW_STYLE}>
        <TimingSignal label={sharedSnapshot ? '共享协作快照' : '本地 handoff 时序'} tone="aux" />
        <TimingSignal label={`范围 ${scopeLabel}`} tone="contrast" />
      </div>
    </section>
  );
}
