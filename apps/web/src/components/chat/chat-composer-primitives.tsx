import React from 'react';
import type { SlashCommandItem } from '../session-conversation/runtime/support.js';

export function getSlashBadgeStyle(source: SlashCommandItem['source']): React.CSSProperties {
  switch (source) {
    case 'agent':
      return {
        background: 'color-mix(in oklch, var(--warning) 14%, transparent)',
        color: 'color-mix(in oklch, var(--warning) 84%, white 16%)',
      };
    case 'mcp':
      return {
        background: 'color-mix(in oklch, var(--info, #3b82f6) 14%, transparent)',
        color: 'color-mix(in oklch, var(--info, #3b82f6) 82%, white 18%)',
      };
    case 'skill':
      return {
        background: 'color-mix(in oklch, var(--accent) 14%, transparent)',
        color: 'color-mix(in oklch, var(--accent) 80%, white 20%)',
      };
    case 'tool':
      return {
        background: 'color-mix(in oklch, var(--success, #10b981) 14%, transparent)',
        color: 'color-mix(in oklch, var(--success, #10b981) 82%, white 18%)',
      };
    default:
      return {
        background: 'var(--accent-muted)',
        color: 'var(--accent)',
      };
  }
}

export const composerHeaderTitleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--text)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

export const composerListPrimaryTextStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

export function ComposerHintChip({
  label,
  tone = 'default',
}: {
  label: string;
  tone?: 'default' | 'accent';
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 20,
        padding: '0 7px',
        borderRadius: 999,
        border: '1px solid var(--border-subtle)',
        background: tone === 'accent' ? 'var(--accent-muted)' : 'transparent',
        color: tone === 'accent' ? 'var(--accent)' : 'var(--text-3)',
        fontSize: 10,
        fontWeight: tone === 'accent' ? 600 : 500,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {label}
    </span>
  );
}
