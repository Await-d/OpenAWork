import { useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { tokens } from '../tokens.js';

export interface ShellCardProps {
  children: ReactNode;
  style?: CSSProperties;
}

export function ShellCard({ children, style }: ShellCardProps) {
  return (
    <div
      style={{
        background: tokens.color.surfaceGlass,
        border: `1px solid ${tokens.color.border}`,
        borderRadius: tokens.radius.lg,
        boxShadow: tokens.shadow.glass,
        backdropFilter: tokens.blur.md,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export interface RailButtonProps {
  icon: string;
  label: string;
  isActive: boolean;
  onClick: () => void;
}

export function RailButton({ icon, label, isActive, onClick }: RailButtonProps) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      style={{
        width: 48,
        height: 48,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: isActive
          ? `color-mix(in srgb, ${tokens.color.accent} 15%, transparent)`
          : 'transparent',
        border: 'none',
        borderLeft: isActive ? `2px solid ${tokens.color.accent}` : '2px solid transparent',
        cursor: 'pointer',
        fontSize: 15,
        color: isActive ? tokens.color.accent : tokens.color.muted,
        transition: 'background 0.15s, color 0.15s',
        flexShrink: 0,
      }}
    >
      {icon}
    </button>
  );
}

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
            padding: '8px 12px',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: tokens.color.muted,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          <span>{title}</span>
          <span style={{ fontSize: 10 }}>{open ? '▾' : '▸'}</span>
        </button>
      ) : (
        <div
          style={{
            padding: '8px 12px',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: tokens.color.muted,
          }}
        >
          {title}
        </div>
      )}
      {open && <div>{children}</div>}
    </div>
  );
}

type StatusColor = 'success' | 'warning' | 'danger' | 'info' | 'muted';

export interface StatusPillProps {
  label: string;
  color: StatusColor;
}

const colorMap: Record<StatusColor, { bg: string; text: string }> = {
  success: {
    bg: `color-mix(in srgb, ${tokens.color.success} 15%, transparent)`,
    text: tokens.color.success,
  },
  warning: {
    bg: `color-mix(in srgb, ${tokens.color.warning} 15%, transparent)`,
    text: tokens.color.warning,
  },
  danger: {
    bg: `color-mix(in srgb, ${tokens.color.danger} 15%, transparent)`,
    text: tokens.color.danger,
  },
  info: {
    bg: `color-mix(in srgb, ${tokens.color.info} 15%, transparent)`,
    text: tokens.color.info,
  },
  muted: {
    bg: `color-mix(in srgb, ${tokens.color.muted} 15%, transparent)`,
    text: tokens.color.muted,
  },
};

export function StatusPill({
  label,
  color,
  ...rest
}: StatusPillProps & HTMLAttributes<HTMLSpanElement>) {
  const c = colorMap[color];
  return (
    <span
      {...rest}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: `${tokens.spacing.xxs}px ${tokens.spacing.sm}px`,
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        background: c.bg,
        color: c.text,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}
