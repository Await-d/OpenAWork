import type { AgentOfficeStatus } from './team-runtime-types.js';

export const ROLE_SLOT_CONFIG = [
  {
    accent: 'var(--warning)',
    badge: '团',
    fallbackLabel: '团队负责人',
    fallbackProvider: 'Planner',
    id: 'leader',
    leader: true,
  },
  {
    accent: 'var(--accent)',
    badge: '研',
    fallbackLabel: '研究员A',
    fallbackProvider: 'Researcher',
    id: 'researcher-a',
    leader: false,
  },
  {
    accent: 'var(--complement)',
    badge: '执',
    fallbackLabel: '执行者',
    fallbackProvider: 'Executor',
    id: 'researcher-b',
    leader: false,
  },
  {
    accent: 'var(--danger)',
    badge: '审',
    fallbackLabel: '批评者',
    fallbackProvider: 'Reviewer',
    id: 'critic',
    leader: false,
  },
] as const;

export const OFFICE_AGENT_POSITIONS = [
  { x: 73, y: 59 },
  { x: 80, y: 63 },
  { x: 85, y: 66 },
  { x: 76, y: 69 },
] as const;

export type ReferenceOfficeRole = 'planner' | 'researcher' | 'executor' | 'reviewer';

export function mapOfficeStatusFromRole(role: ReferenceOfficeRole): AgentOfficeStatus {
  switch (role) {
    case 'planner':
      return 'discussing';
    case 'researcher':
    case 'executor':
      return 'working';
    case 'reviewer':
      return 'resting';
  }
}

export function resolveOfficeRole(
  role: string | null | undefined,
  index: number,
): ReferenceOfficeRole {
  if (role === 'planner' || role === 'researcher' || role === 'executor' || role === 'reviewer') {
    return role;
  }

  return index === 0
    ? 'planner'
    : index === 1
      ? 'researcher'
      : index === 2
        ? 'executor'
        : 'reviewer';
}
