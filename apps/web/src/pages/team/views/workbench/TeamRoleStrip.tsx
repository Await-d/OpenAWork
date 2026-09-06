/**
 * TeamRoleStrip · 角色 chip 条
 *
 * 含「全部」chip + 各 role chip，展示 run/fail/idle 状态。
 */

import type { CSSProperties } from 'react';

export interface TeamRoleStripRole {
  readonly id: string;
  readonly name: string;
  readonly state: 'run' | 'fail' | 'idle' | string;
  readonly color?: string;
}

export interface TeamRoleStripProps {
  readonly roles: readonly TeamRoleStripRole[];
  readonly activeRoleId: 'all' | string;
  readonly onSelect: (roleId: 'all' | string) => void;
}

const stripStyle: CSSProperties = {
  display: 'flex',
  gap: 0,
  flexWrap: 'nowrap',
  overflowX: 'auto',
  overflowY: 'hidden',
  padding: 0,
  scrollbarWidth: 'thin',
  scrollbarColor: 'var(--border-default) transparent',
};

function chipStyle(isActive: boolean, tone: string): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    minHeight: 26,
    padding: '0 9px',
    borderRadius: 0,
    borderTop: 'none',
    borderBottom: 'none',
    borderLeft: 'none',
    borderRight: '1px solid var(--border-default)',
    background: isActive ? `color-mix(in srgb, ${tone} 12%, var(--bg-base))` : 'var(--bg-base)',
    color: isActive ? tone : 'var(--fg-muted)',
    fontSize: 10.5,
    fontWeight: 650,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}

function stateDotColor(state: string): string {
  switch (state) {
    case 'run':
      return 'var(--success)';
    case 'fail':
      return 'var(--error, var(--warning))';
    default:
      return 'var(--fg-subtle)';
  }
}

const dotStyle: CSSProperties = {
  width: 5,
  height: 5,
  borderRadius: '50%',
  flexShrink: 0,
};

export function TeamRoleStrip({ roles, activeRoleId, onSelect }: TeamRoleStripProps) {
  return (
    <div role="group" aria-label="角色筛选" style={stripStyle}>
      <button
        type="button"
        aria-pressed={activeRoleId === 'all'}
        style={chipStyle(activeRoleId === 'all', 'var(--accent)')}
        onClick={() => onSelect('all')}
      >
        全部
      </button>

      {roles.map((role) => {
        const isActive = activeRoleId === role.id;
        const tone = roleStateTone(role);

        return (
          <button
            key={role.id}
            type="button"
            aria-pressed={isActive}
            style={chipStyle(isActive, tone)}
            onClick={() => onSelect(role.id)}
          >
            <span
              style={{ ...dotStyle, background: stateDotColor(role.state) }}
              aria-hidden="true"
            />
            <span>{role.name}</span>
          </button>
        );
      })}
    </div>
  );
}

function roleStateTone(role: TeamRoleStripRole): string {
  if (role.color) return role.color;
  switch (role.state) {
    case 'run':
      return 'var(--success)';
    case 'fail':
      return 'var(--error, var(--warning))';
    default:
      return 'var(--fg-muted)';
  }
}
