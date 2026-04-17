import { useState, useCallback, useEffect } from 'react';
import type { AgentTeamsSidebarTeam } from './team-runtime-types.js';
import { useTeamRuntimeReferenceViewData } from './team-runtime-reference-data.js';
import { PANEL_STYLE } from './team-runtime-shared.js';
import { ChevronDownIcon, PauseIcon, ResumeIcon, TrashIcon } from './TeamIcons.js';

function TeamCard({
  allowManage,
  team,
  isSelected,
  onSelect,
  onTogglePause,
  onDelete,
}: {
  allowManage: boolean;
  team: AgentTeamsSidebarTeam;
  isSelected: boolean;
  onSelect: () => void;
  onTogglePause: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const statusColor =
    team.status === 'running'
      ? 'var(--success)'
      : team.status === 'paused'
        ? 'var(--warning)'
        : 'var(--text-3)';
  const statusLabel =
    team.status === 'running' ? '运行中' : team.status === 'paused' ? '已暂停' : '已完成';
  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 10,
        border: isSelected ? '1px solid var(--accent)' : '1px solid var(--border-subtle)',
        background: isSelected
          ? 'color-mix(in oklch, var(--accent) 6%, var(--card-bg))'
          : 'var(--card-bg)',
        display: 'grid',
        gap: 5,
        transition: 'border-color 0.15s, background 0.15s',
        borderLeft: `3px solid ${isSelected ? 'var(--accent)' : statusColor}`,
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        style={{
          appearance: 'none',
          display: 'grid',
          gap: 5,
          padding: 0,
          margin: 0,
          border: 'none',
          background: 'transparent',
          textAlign: 'left',
          cursor: 'pointer',
        }}
        onMouseEnter={(e) => {
          if (!isSelected) {
            const card = e.currentTarget.parentElement;
            if (!card) return;
            card.style.borderColor = 'var(--border)';
            card.style.background = 'var(--surface-hover)';
          }
        }}
        onMouseLeave={(e) => {
          if (!isSelected) {
            const card = e.currentTarget.parentElement;
            if (!card) return;
            card.style.borderColor = 'var(--border-subtle)';
            card.style.background = 'var(--card-bg)';
          }
        }}
      >
        <div
          style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}
        >
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{team.title}</span>
          <span
            style={{
              padding: '1px 6px',
              borderRadius: 999,
              background:
                team.status === 'running'
                  ? 'color-mix(in oklch, var(--success) 12%, transparent)'
                  : team.status === 'paused'
                    ? 'color-mix(in oklch, var(--warning) 12%, transparent)'
                    : 'color-mix(in oklch, var(--text-3) 10%, transparent)',
              color: statusColor,
              fontSize: 9,
              fontWeight: 700,
            }}
          >
            {statusLabel}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: statusColor,
              boxShadow: team.status === 'running' ? `0 0 4px ${statusColor}` : 'none',
            }}
          />
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{team.subtitle}</span>
        </div>
      </button>
      {allowManage && isSelected && (
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', paddingTop: 2 }}>
          {team.status !== 'completed' && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onTogglePause(team.id);
              }}
              style={{
                padding: '3px 7px',
                borderRadius: 5,
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--text-3)',
                fontSize: 10,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
              }}
            >
              {team.status === 'running' ? (
                <>
                  <PauseIcon size={9} color="var(--warning)" /> 暂停
                </>
              ) : (
                <>
                  <ResumeIcon size={9} color="var(--success)" /> 恢复
                </>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDelete(team.id);
            }}
            style={{
              padding: '3px 7px',
              borderRadius: 5,
              border: '1px solid color-mix(in oklch, var(--danger) 30%, transparent)',
              background: 'transparent',
              color: 'var(--danger)',
              fontSize: 10,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
            }}
          >
            <TrashIcon size={9} color="var(--danger)" /> 删除
          </button>
        </div>
      )}
    </div>
  );
}

export function TeamsTab() {
  const {
    canManageSessionEntries,
    defaultSelectedTeamId,
    deleteSession: deleteSessionAction,
    historyTeams,
    runningTeams,
    selectTeam,
    toggleSessionState,
  } = useTeamRuntimeReferenceViewData();
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(defaultSelectedTeamId);

  const toggleSection = useCallback((id: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const togglePause = useCallback(
    (id: string) => {
      const team = [...runningTeams, ...historyTeams].find((t) => t.id === id);
      if (!team) return;
      void toggleSessionState(id, team.status);
    },
    [toggleSessionState, runningTeams, historyTeams],
  );

  const deleteTeam = useCallback(
    (id: string) => {
      void deleteSessionAction(id);
    },
    [deleteSessionAction],
  );

  useEffect(() => {
    setSelectedTeamId(defaultSelectedTeamId);
  }, [defaultSelectedTeamId]);

  const getEffectiveStatus = (team: AgentTeamsSidebarTeam) => {
    return team.status;
  };

  const visibleRunning = runningTeams;
  const visibleHistory = historyTeams;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {/* Running teams */}
      <section
        style={{ ...PANEL_STYLE, padding: '10px 12px', borderRadius: 10, display: 'grid', gap: 10 }}
      >
        <button
          type="button"
          onClick={() => toggleSection('running')}
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            color: 'var(--text-3)',
            fontSize: 12,
            fontWeight: 800,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            textAlign: 'left',
          }}
        >
          <span
            style={{
              transition: 'transform 0.15s',
              transform: collapsedSections.has('running') ? 'rotate(-90deg)' : 'none',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            <ChevronDownIcon size={11} color="var(--text-3)" />
          </span>
          <span style={{ color: 'var(--text-2)' }}>运行中</span>
          <span
            style={{
              minWidth: 18,
              height: 18,
              borderRadius: 6,
              display: 'grid',
              placeItems: 'center',
              background: 'var(--surface-2)',
              color: 'var(--text-2)',
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            {visibleRunning.length}
          </span>
        </button>
        {!collapsedSections.has('running') && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: 8,
            }}
          >
            {visibleRunning.map((team) => (
              <TeamCard
                allowManage={canManageSessionEntries}
                key={team.id}
                team={{ ...team, status: getEffectiveStatus(team) }}
                isSelected={selectedTeamId === team.id}
                onSelect={() => {
                  const nextId = selectedTeamId === team.id ? null : team.id;
                  setSelectedTeamId(nextId);
                  if (nextId) {
                    selectTeam(nextId);
                  }
                }}
                onTogglePause={togglePause}
                onDelete={deleteTeam}
              />
            ))}
          </div>
        )}
      </section>

      {/* History teams */}
      <section
        style={{ ...PANEL_STYLE, padding: '10px 12px', borderRadius: 10, display: 'grid', gap: 10 }}
      >
        <button
          type="button"
          onClick={() => toggleSection('history')}
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            color: 'var(--text-3)',
            fontSize: 12,
            fontWeight: 800,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            textAlign: 'left',
          }}
        >
          <span
            style={{
              transition: 'transform 0.15s',
              transform: collapsedSections.has('history') ? 'rotate(-90deg)' : 'none',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            <ChevronDownIcon size={11} color="var(--text-3)" />
          </span>
          <span style={{ color: 'var(--text-2)' }}>历史记录</span>
          <span
            style={{
              minWidth: 18,
              height: 18,
              borderRadius: 6,
              display: 'grid',
              placeItems: 'center',
              background: 'var(--surface-2)',
              color: 'var(--text-2)',
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            {visibleHistory.length}
          </span>
        </button>
        {!collapsedSections.has('history') && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: 8,
            }}
          >
            {visibleHistory.map((team) => (
              <TeamCard
                allowManage={canManageSessionEntries}
                key={team.id}
                team={team}
                isSelected={selectedTeamId === team.id}
                onSelect={() => {
                  const nextId = selectedTeamId === team.id ? null : team.id;
                  setSelectedTeamId(nextId);
                  if (nextId) {
                    selectTeam(nextId);
                  }
                }}
                onTogglePause={togglePause}
                onDelete={deleteTeam}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
