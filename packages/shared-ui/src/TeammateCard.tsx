import type { CSSProperties } from 'react';
import { formatCanonicalRole } from '@openAwork/shared';
import type { CanonicalRoleDescriptor } from '@openAwork/shared';

export type MemberStatus = 'idle' | 'working' | 'done' | 'error';

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  canonicalRole?: CanonicalRoleDescriptor;
  status: MemberStatus;
  currentTask?: string;
}

export interface TeammateCardProps {
  member: TeamMember;
  style?: CSSProperties;
}

const STATUS_COLOR: Record<MemberStatus, string> = {
  idle: 'var(--color-muted, #94a3b8)',
  working: '#38bdf8',
  done: '#34d399',
  error: '#f87171',
};

const STATUS_LABEL: Record<MemberStatus, string> = {
  idle: '空闲',
  working: '工作中',
  done: '已完成',
  error: '错误',
};

const STATUS_DOT_BG: Record<MemberStatus, string> = {
  idle: '#1e293b',
  working: '#0c4a6e',
  done: '#064e3b',
  error: '#7f1d1d',
};

export function TeammateCard({ member, style }: TeammateCardProps) {
  const initials = member.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
  const roleLabel = member.canonicalRole
    ? `${member.role} · ${formatCanonicalRole(member.canonicalRole)}`
    : member.role;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0.55rem 0.875rem',
        ...style,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: STATUS_DOT_BG[member.status],
          border: `1.5px solid ${STATUS_COLOR[member.status]}60`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          fontWeight: 700,
          color: STATUS_COLOR[member.status],
          flexShrink: 0,
          letterSpacing: 0.5,
        }}
      >
        {initials}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--color-text, #f1f5f9)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {member.name}
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--color-muted, #94a3b8)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {member.currentTask ?? roleLabel}
        </div>
      </div>

      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: STATUS_COLOR[member.status],
          flexShrink: 0,
          padding: '0.15rem 0.45rem',
          borderRadius: 4,
          background: STATUS_DOT_BG[member.status],
          border: `1px solid ${STATUS_COLOR[member.status]}40`,
        }}
      >
        {STATUS_LABEL[member.status]}
      </span>
    </div>
  );
}
