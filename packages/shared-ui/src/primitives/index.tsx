import { useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { color, radius, spacing, shadow, motion } from '../tokens.js';

// ── ShellCard ─────────────────────────────────────────────

export interface ShellCardProps {
  children: ReactNode;
  style?: CSSProperties;
  variant?: 'default' | 'featured';
}

export function ShellCard({ children, style, variant = 'default' }: ShellCardProps) {
  return (
    <div
      style={{
        background: `linear-gradient(180deg, ${color.bgOverlay}, ${color.bgRaised})`,
        border: `1px solid ${variant === 'featured' ? color.accentBorder : color.borderDefault}`,
        borderRadius: radius.lg,
        boxShadow: variant === 'featured' ? shadow.glow : shadow.sm,
        position: 'relative',
        overflow: 'hidden',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ── RailButton ────────────────────────────────────────────

export interface RailButtonProps {
  icon: ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
  badge?: string | number;
}

export function RailButton({ icon, label, isActive, onClick, badge }: RailButtonProps) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: spacing[3],
        padding: `${spacing[2]}px ${spacing[3]}px`,
        borderRadius: radius.sm,
        background: isActive ? color.accentSubtle : 'transparent',
        border: `1px solid ${isActive ? color.accentBorder : 'transparent'}`,
        cursor: 'pointer',
        fontSize: 12.5,
        fontWeight: 500,
        color: isActive ? color.fgStrong : color.fgMuted,
        transition: `all ${motion.micro.duration} ${motion.micro.easing}`,
        position: 'relative',
        width: '100%',
        textAlign: 'left',
      }}
    >
      <span
        style={{
          width: 18,
          height: 18,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: isActive ? color.accent : color.fgSubtle,
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
      {badge != null && (
        <span
          style={{
            minWidth: 18,
            height: 18,
            padding: '0 5px',
            borderRadius: radius.pill,
            background: color.accent,
            color: color.fgOnAccent,
            fontSize: 10,
            fontWeight: 700,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

// ── PanelSection ──────────────────────────────────────────

export interface PanelSectionProps {
  title: string;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}

export function PanelSection({
  title,
  children,
  collapsible = false,
  defaultOpen = true,
}: PanelSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={{
            padding: `${spacing[2]}px ${spacing[3]}px`,
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: color.fgSubtle,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            userSelect: 'none',
            transition: `color ${motion.micro.duration} ${motion.micro.easing}`,
          }}
        >
          <span>{title}</span>
          <span style={{ fontSize: 10 }}>{open ? '▾' : '▸'}</span>
        </button>
      ) : (
        <div
          style={{
            padding: `${spacing[3]}px ${spacing[3]}px ${spacing[1]}px`,
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: color.fgSubtle,
          }}
        >
          {title}
        </div>
      )}
      {open && <div>{children}</div>}
    </div>
  );
}

// ── StatusPill ────────────────────────────────────────────

type StatusColor = 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'muted';

export interface StatusPillProps {
  label: string;
  color: StatusColor;
}

const pillColorMap: Record<StatusColor, { bg: string; fg: string; border: string }> = {
  success: { bg: color.successMuted, fg: color.success, border: color.successBorder },
  warning: { bg: color.warningMuted, fg: color.warning, border: color.warningBorder },
  danger: { bg: color.dangerMuted, fg: color.danger, border: color.dangerBorder },
  info: { bg: color.infoMuted, fg: color.info, border: color.infoBorder },
  accent: { bg: color.accentMuted, fg: color.accent, border: color.accentBorder },
  muted: { bg: color.bgSurface, fg: color.fgMuted, border: color.borderDefault },
};

export function StatusPill({
  label,
  color: statusColor,
  ...rest
}: StatusPillProps & HTMLAttributes<HTMLSpanElement>) {
  const c = pillColorMap[statusColor];
  return (
    <span
      {...rest}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: `3px ${spacing[3]}px`,
        borderRadius: radius.pill,
        fontSize: 11,
        fontWeight: 600,
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.border}`,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}
