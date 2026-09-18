/**
 * TeamRoleStrip · 角色筛选 chips 行
 *
 * 主次分层中的 L2 次级筛选：轻量胶囊（无边框 / 透明底），选中态 accent 浅底 +
 * accent 文字；视觉态由 `team-workbench-controls.css` 的 `.team-wb-filter-chip`
 * 提供，组件只保留结构与状态点。
 */

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

function roleStateTone(role: TeamRoleStripRole): string {
  if (role.color) return role.color;
  return stateDotColor(role.state);
}

export function TeamRoleStrip({ roles, activeRoleId, onSelect }: TeamRoleStripProps) {
  return (
    <div role="group" aria-label="角色筛选" className="team-wb-chip-scroll">
      <button
        type="button"
        aria-pressed={activeRoleId === 'all'}
        className="team-wb-filter-chip"
        onClick={() => onSelect('all')}
      >
        全部
      </button>

      {roles.map((role) => {
        const isActive = activeRoleId === role.id;

        return (
          <button
            key={role.id}
            type="button"
            aria-pressed={isActive}
            className="team-wb-filter-chip"
            onClick={() => onSelect(role.id)}
          >
            <span
              className="team-wb-chip-dot"
              style={{ background: roleStateTone(role) }}
              aria-hidden="true"
            />
            <span>{role.name}</span>
          </button>
        );
      })}
    </div>
  );
}
