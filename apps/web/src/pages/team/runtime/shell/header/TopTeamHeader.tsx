import type { AgentTeamsRoleChip, AgentTeamsSidebarTeam } from '../../data/team-runtime-types.js';
import { ChromeBadge } from '../team-runtime-shell-primitives.js';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import {
  ExpandRightIcon,
  TeamsIcon,
  ResumeIcon,
  PauseIcon,
  CheckIcon,
} from '../../shared/TeamIcons.js';

function RoleChip({
  item,
  isSelected,
  onSelect,
}: {
  item: AgentTeamsRoleChip;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="team-role-chip"
      data-active={isSelected || undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        minHeight: 26,
        background: isSelected ? `${item.accent}15` : 'transparent',
        border: isSelected ? `1px solid ${item.accent}40` : '1px solid transparent',
        borderRadius: 999,
        padding: '2px 8px 2px 4px',
        cursor: 'pointer',
        ['--chip-accent' as string]: item.accent,
      }}
    >
      <span
        style={{
          width: 20,
          height: 20,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          background: item.accent,
          color: 'var(--fg-strong)',
          fontSize: 9,
          fontWeight: 800,
        }}
      >
        {item.badge}
      </span>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-strong)' }}>{item.role}</span>
      {item.leader ? (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '0 5px',
            borderRadius: 999,
            background: 'color-mix(in oklch, var(--warning) 12%, transparent)',
            color: 'var(--warning)',
            fontSize: 9,
            fontWeight: 700,
          }}
        >
          Leader
        </span>
      ) : null}
      <span
        style={{
          padding: '0 5px',
          borderRadius: 999,
          background: 'color-mix(in oklch, var(--success) 10%, transparent)',
          color: 'var(--success)',
          fontSize: 9,
          fontWeight: 600,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 2,
        }}
      >
        <CheckIcon size={8} color="var(--success)" /> {item.status}
      </span>
      <span style={{ color: 'var(--fg-muted)', fontSize: 10 }}>{item.provider}</span>
    </button>
  );
}

export function TopTeamHeader({
  selectedTeam,
  canManageRuntime,
  selectedAgentId,
  onSelectAgent,
  isPaused,
  onTogglePause,
  onExpandSidebar,
}: {
  canManageRuntime: boolean;
  selectedAgentId: string;
  onSelectAgent: (id: string) => void;
  isPaused: boolean;
  onTogglePause: () => void;
  onExpandSidebar?: () => void;
  selectedTeam: AgentTeamsSidebarTeam | null;
}) {
  const {
    activeMode,
    error,
    feedback,
    loading,
    roleChips,
    topSummary,
    workspaceGroups,
    workspaces,
  } = useTeamRuntimeReferenceViewData();

  return (
    <header
      style={{
        display: 'grid',
        gap: 6,
        padding: '8px 16px 6px',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <div
        style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}
      >
        <div
          style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0, flexWrap: 'wrap' }}
        >
          {onExpandSidebar && (
            <button
              type="button"
              onClick={onExpandSidebar}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--fg-muted)',
                cursor: 'pointer',
                fontSize: 12,
                padding: 0,
                lineHeight: 1,
              }}
              title="展开侧边栏"
            >
              <ExpandRightIcon size={12} color="var(--fg-muted)" />
            </button>
          )}
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '2px 8px',
              borderRadius: 999,
              background: 'color-mix(in oklch, var(--accent) 10%, transparent)',
            }}
          >
            <TeamsIcon size={11} color="var(--accent)" />
            <span style={{ color: 'var(--accent)', fontSize: 11, fontWeight: 700 }}>
              AGENT TEAMS
            </span>
          </span>
          <span
            style={{
              fontSize: 18,
              fontWeight: 800,
              color: 'var(--fg-strong)',
              letterSpacing: '-0.02em',
            }}
          >
            {topSummary.title}
          </span>
          <span
            style={{
              padding: '2px 8px',
              borderRadius: 999,
              background: isPaused
                ? 'color-mix(in oklch, var(--warning) 12%, transparent)'
                : 'color-mix(in oklch, var(--success) 15%, transparent)',
              color: isPaused ? 'var(--warning)' : 'var(--success)',
              fontSize: 10,
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
            }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                background: isPaused ? 'var(--warning)' : 'var(--success)',
                boxShadow: isPaused ? 'none' : '0 0 4px var(--success)',
              }}
            />
            {isPaused ? '已暂停' : '运行中'}
          </span>
          <span
            style={{
              padding: '1px 6px',
              borderRadius: 999,
              background: 'var(--bg-overlay)',
              fontSize: 10,
              color: 'var(--fg-muted)',
            }}
          >
            {topSummary.memberCount}
          </span>
          <span
            style={{
              padding: '1px 6px',
              borderRadius: 999,
              background: 'color-mix(in oklch, var(--success) 10%, transparent)',
              fontSize: 10,
              color: 'var(--success)',
            }}
          >
            {topSummary.onlineCount}
          </span>
          <ChromeBadge>
            {activeMode === 'live' ? '已接入真实 Team Runtime' : '等待 Team Runtime'}
          </ChromeBadge>
          <ChromeBadge>{workspaces.length} 工作区</ChromeBadge>
          <ChromeBadge>{workspaceGroups.length} 分组</ChromeBadge>
          {selectedTeam ? <ChromeBadge>当前会话 {selectedTeam.title}</ChromeBadge> : null}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          {canManageRuntime ? (
            <button
              type="button"
              onClick={onTogglePause}
              className="team-glow-press"
              data-tone={isPaused ? 'success' : 'danger'}
              style={{
                position: 'relative',
                minHeight: 32,
                padding: '0 14px',
                borderRadius: 999,
                border: 'none',
                background: isPaused
                  ? 'linear-gradient(135deg, color-mix(in oklch, var(--success) 22%, var(--bg-base)) 0%, color-mix(in oklch, var(--success) 8%, var(--bg-base)) 100%)'
                  : 'linear-gradient(135deg, color-mix(in oklch, var(--danger) 22%, var(--bg-base)) 0%, color-mix(in oklch, var(--danger) 8%, var(--bg-base)) 100%)',
                color: isPaused ? 'var(--success)' : 'var(--danger)',
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: '0.02em',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: isPaused
                  ? '0 0 12px color-mix(in oklch, var(--success) 25%, transparent), inset 0 1px 0 color-mix(in oklch, var(--success) 18%, transparent)'
                  : '0 0 12px color-mix(in oklch, var(--danger) 25%, transparent), inset 0 1px 0 color-mix(in oklch, var(--danger) 18%, transparent)',
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: isPaused ? 'var(--success)' : 'var(--danger)',
                  boxShadow: isPaused ? '0 0 6px var(--success)' : '0 0 6px var(--danger)',
                  animation: isPaused
                    ? 'pulse-glow-success 2s ease-in-out infinite'
                    : 'pulse-glow-danger 2s ease-in-out infinite',
                }}
              />
              {isPaused ? (
                <>
                  <ResumeIcon size={12} color="var(--success)" /> 恢复运行
                </>
              ) : (
                <>
                  <PauseIcon size={12} color="var(--danger)" /> 暂停会话
                </>
              )}
            </button>
          ) : (
            <span
              style={{
                minHeight: 32,
                padding: '0 12px',
                borderRadius: 999,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-overlay)',
                color: 'var(--fg-muted)',
                fontSize: 11,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: 'var(--accent)',
                }}
              />
              运行状态由共享会话驱动
            </span>
          )}
          {/* keyframes `pulse-glow-success` / `pulse-glow-danger` 已迁移到
              `styles/team-runtime.css`，由 TeamPageV2.tsx 入口加载。 */}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 10,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.6 }}>
          {topSummary.description}
        </span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <ChromeBadge>{topSummary.status}</ChromeBadge>
          <ChromeBadge>{topSummary.memberCount}</ChromeBadge>
          <ChromeBadge>{topSummary.onlineCount}</ChromeBadge>
          {selectedTeam ? <ChromeBadge>{selectedTeam.subtitle}</ChromeBadge> : null}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {roleChips.map((item) => (
          <RoleChip
            key={item.id}
            item={item}
            isSelected={selectedAgentId === item.id}
            onSelect={() => onSelectAgent(item.id)}
          />
        ))}
      </div>

      {(loading || error || feedback) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {loading ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: 24,
                padding: '0 10px',
                borderRadius: 999,
                background: 'color-mix(in oklch, var(--accent) 10%, transparent)',
                color: 'var(--fg-default)',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              正在同步团队运行数据…
            </span>
          ) : null}
          {error ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: 24,
                padding: '0 10px',
                borderRadius: 999,
                background: 'color-mix(in oklch, var(--danger) 12%, transparent)',
                color: 'var(--danger)',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {error}
            </span>
          ) : null}
          {feedback ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: 24,
                padding: '0 10px',
                borderRadius: 999,
                background:
                  feedback.tone === 'success'
                    ? 'color-mix(in oklch, var(--success) 12%, transparent)'
                    : 'color-mix(in oklch, var(--warning) 12%, transparent)',
                color: feedback.tone === 'success' ? 'var(--success)' : 'var(--warning)',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {feedback.message}
            </span>
          ) : null}
        </div>
      )}
    </header>
  );
}
