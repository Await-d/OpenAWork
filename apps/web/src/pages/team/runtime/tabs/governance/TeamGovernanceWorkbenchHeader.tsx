import type { CSSProperties, ReactNode } from 'react';
import {
  CheckIcon,
  ReviewIcon,
  SecurityIcon,
  SyncIcon,
  TeamsIcon,
  TemplateIcon,
} from '../../shared/TeamIcons.js';

type GovernanceArea = 'templates' | 'shares' | 'audit';
type GovernanceTone = 'accent' | 'aux' | 'success' | 'warning' | 'danger' | 'muted';

export interface GovernanceMetric {
  readonly label: string;
  readonly value: string | number;
  readonly detail?: string;
  readonly tone?: GovernanceTone;
}

export interface GovernanceSignal {
  readonly label: string;
  readonly value: string;
  readonly tone?: GovernanceTone;
}

export interface TeamGovernanceWorkbenchHeaderProps {
  readonly area: GovernanceArea;
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly metrics: readonly GovernanceMetric[];
  readonly signals?: readonly GovernanceSignal[];
  readonly children?: ReactNode;
}

const AREA_META: Record<
  GovernanceArea,
  {
    readonly color: string;
    readonly icon: (props: { readonly size?: number; readonly color?: string }) => ReactNode;
    readonly label: string;
  }
> = {
  templates: {
    color: 'var(--accent)',
    icon: TemplateIcon,
    label: '模板归口',
  },
  shares: {
    color: 'var(--aux)',
    icon: TeamsIcon,
    label: '共享协作',
  },
  audit: {
    color: 'var(--warning)',
    icon: SecurityIcon,
    label: '审计追踪',
  },
};

const TONE_COLOR: Record<GovernanceTone, string> = {
  accent: 'var(--accent)',
  aux: 'var(--aux)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  muted: 'var(--fg-muted)',
};

const HEADER_STYLE: CSSProperties = {
  display: 'grid',
  gap: 14,
  padding: '14px 16px',
  borderRadius: 12,
  border: '1px solid color-mix(in srgb, var(--border-default) 58%, transparent)',
  background:
    'linear-gradient(180deg, color-mix(in srgb, var(--bg-overlay) 92%, var(--accent-subtle)), color-mix(in srgb, var(--bg-raised) 86%, var(--bg-base)))',
  boxShadow: 'var(--shadow-sm)',
};

const HERO_ROW_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto minmax(0, 1fr) auto',
  gap: 12,
  alignItems: 'start',
};

const ICON_BOX_STYLE: CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 10,
  display: 'grid',
  placeItems: 'center',
  border: '1px solid color-mix(in srgb, currentColor 28%, transparent)',
  background: 'color-mix(in srgb, currentColor 12%, transparent)',
};

const EYEBROW_STYLE: CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: '0.06em',
  color: 'var(--fg-muted)',
  textTransform: 'uppercase',
};

const TITLE_STYLE: CSSProperties = {
  fontSize: 15,
  fontWeight: 800,
  color: 'var(--fg-strong)',
  lineHeight: 1.25,
};

const DESCRIPTION_STYLE: CSSProperties = {
  fontSize: 11.5,
  color: 'var(--fg-muted)',
  lineHeight: 1.6,
};

const AREA_PILL_STYLE: CSSProperties = {
  minHeight: 24,
  padding: '0 9px',
  borderRadius: 999,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 10,
  fontWeight: 800,
  border: '1px solid color-mix(in srgb, currentColor 32%, transparent)',
  background: 'color-mix(in srgb, currentColor 10%, var(--bg-overlay))',
};

const METRICS_GRID_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))',
  gap: 8,
};

const METRIC_CARD_STYLE: CSSProperties = {
  minHeight: 58,
  padding: '9px 10px',
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border-default) 48%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 82%, var(--bg-base))',
  display: 'grid',
  gap: 4,
};

const SIGNAL_ROW_STYLE: CSSProperties = {
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
  alignItems: 'center',
};

export function TeamGovernanceWorkbenchHeader({
  area,
  eyebrow,
  title,
  description,
  metrics,
  signals = [],
  children,
}: TeamGovernanceWorkbenchHeaderProps) {
  const areaMeta = AREA_META[area];
  const AreaIcon = areaMeta.icon;

  return (
    <section aria-label="治理工作台摘要" style={HEADER_STYLE}>
      <div style={HERO_ROW_STYLE}>
        <div style={{ ...ICON_BOX_STYLE, color: areaMeta.color }}>
          <AreaIcon size={18} color="currentColor" />
        </div>
        <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
          <span style={EYEBROW_STYLE}>{eyebrow}</span>
          <strong style={TITLE_STYLE}>{title}</strong>
          <span style={DESCRIPTION_STYLE}>{description}</span>
        </div>
        <span style={{ ...AREA_PILL_STYLE, color: areaMeta.color }}>
          <ReviewIcon size={12} color="currentColor" />
          {areaMeta.label}
        </span>
      </div>

      <div style={METRICS_GRID_STYLE}>
        {metrics.map((metric) => {
          const tone = metric.tone ?? 'muted';
          const color = TONE_COLOR[tone];
          return (
            <div key={metric.label} style={METRIC_CARD_STYLE}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-muted)' }}>
                {metric.label}
              </span>
              <span
                style={{
                  color,
                  fontSize: 19,
                  fontWeight: 800,
                  lineHeight: 1,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {metric.value}
              </span>
              {metric.detail ? (
                <span style={{ fontSize: 10.5, color: 'var(--fg-muted)', lineHeight: 1.4 }}>
                  {metric.detail}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      {signals.length > 0 || children ? (
        <div style={SIGNAL_ROW_STYLE}>
          {signals.map((signal) => {
            const tone = signal.tone ?? 'muted';
            const color = TONE_COLOR[tone];
            return (
              <span
                key={`${signal.label}:${signal.value}`}
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
                {tone === 'success' ? (
                  <CheckIcon size={11} color="currentColor" />
                ) : (
                  <SyncIcon size={11} color="currentColor" />
                )}
                <span style={{ color: 'var(--fg-muted)' }}>{signal.label}</span>
                <span>{signal.value}</span>
              </span>
            );
          })}
          {children}
        </div>
      ) : null}
    </section>
  );
}
