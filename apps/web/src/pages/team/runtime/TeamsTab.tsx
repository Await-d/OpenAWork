import { useState, useCallback, useEffect } from 'react';
import type { AgentTeamsSidebarTeam } from './team-runtime-reference-mock.js';
import { useTeamRuntimeReferenceViewData } from './team-runtime-reference-data.js';
import { PANEL_STYLE } from './team-runtime-shared.js';
import { ChevronDownIcon, PlusIcon, PauseIcon, ResumeIcon, TrashIcon } from './TeamIcons.js';

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
    <button
      type="button"
      onClick={onSelect}
      style={{
        appearance: 'none',
        padding: '10px 12px',
        borderRadius: 10,
        border: isSelected ? '1px solid var(--accent)' : '1px solid var(--border-subtle)',
        background: isSelected
          ? 'color-mix(in oklch, var(--accent) 6%, var(--card-bg))'
          : 'var(--card-bg)',
        display: 'grid',
        gap: 5,
        cursor: 'pointer',
        transition: 'border-color 0.15s, background 0.15s',
        borderLeft: `3px solid ${isSelected ? 'var(--accent)' : statusColor}`,
      }}
      onMouseEnter={(e) => {
        if (!isSelected) {
          e.currentTarget.style.borderColor = 'var(--border)';
          e.currentTarget.style.background = 'var(--surface-hover)';
        }
      }}
      onMouseLeave={(e) => {
        if (!isSelected) {
          e.currentTarget.style.borderColor = 'var(--border-subtle)';
          e.currentTarget.style.background = 'var(--card-bg)';
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
    </button>
  );
}

export function TeamsTab({ onNewTemplate }: { onNewTemplate: () => void }) {
  const {
    canCreateTemplate,
    canManageSessionEntries,
    defaultSelectedTeamId,
    historyTeams,
    runningTeams,
    selectTeam,
    sidebarSections,
    templateCount,
    templateError,
    templateLoading,
  } = useTeamRuntimeReferenceViewData();
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(defaultSelectedTeamId);
  const [pausedTeamIds, setPausedTeamIds] = useState<Set<string>>(new Set());
  const [deletedTeamIds, setDeletedTeamIds] = useState<Set<string>>(new Set());

  const toggleSection = useCallback((id: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const togglePause = useCallback((id: string) => {
    setPausedTeamIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const deleteTeam = useCallback((id: string) => {
    setDeletedTeamIds((prev) => new Set(prev).add(id));
  }, []);

  useEffect(() => {
    setSelectedTeamId(defaultSelectedTeamId);
  }, [defaultSelectedTeamId]);

  const getEffectiveStatus = (team: AgentTeamsSidebarTeam) => {
    if (pausedTeamIds.has(team.id)) return 'paused' as const;
    return team.status;
  };

  const visibleRunning = runningTeams.filter((t) => !deletedTeamIds.has(t.id));
  const visibleHistory = historyTeams.filter((t) => !deletedTeamIds.has(t.id));

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

      {/* Templates */}
      <section
        style={{ ...PANEL_STYLE, padding: '10px 12px', borderRadius: 10, display: 'grid', gap: 10 }}
      >
        <button
          type="button"
          onClick={() => toggleSection('templates')}
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
              transform: collapsedSections.has('templates') ? 'rotate(-90deg)' : 'none',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            <ChevronDownIcon size={11} color="var(--text-3)" />
          </span>
          <span style={{ color: 'var(--text-2)' }}>团队模板</span>
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
            {templateCount}
          </span>
        </button>
        {!collapsedSections.has('templates') && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: 8,
            }}
          >
            {templateLoading ? (
              <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-3)' }}>
                正在同步团队模板…
              </div>
            ) : null}
            {templateError ? (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid color-mix(in oklch, var(--danger) 35%, transparent)',
                  background: 'color-mix(in oklch, var(--danger) 8%, transparent)',
                  color: 'var(--danger)',
                  fontSize: 11,
                  lineHeight: 1.5,
                }}
              >
                {templateError}
              </div>
            ) : null}
            {!templateLoading && templateCount === 0 ? (
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: '1px dashed var(--border)',
                  color: 'var(--text-3)',
                  fontSize: 11,
                  lineHeight: 1.6,
                }}
              >
                暂无团队模板。点击下方按钮即可创建一个持久化团队模板，并同步到工作流模板库。
              </div>
            ) : null}
            {sidebarSections.map((section) =>
              section.items.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  style={{
                    appearance: 'none',
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--card-bg)',
                    display: 'grid',
                    gap: 6,
                    cursor: canCreateTemplate ? 'pointer' : 'not-allowed',
                    transition: 'border-color 0.15s, background 0.15s',
                    opacity: canCreateTemplate ? 1 : 0.6,
                  }}
                  onClick={canCreateTemplate ? onNewTemplate : undefined}
                  disabled={!canCreateTemplate}
                  onMouseEnter={(e) => {
                    if (!canCreateTemplate) {
                      return;
                    }
                    e.currentTarget.style.borderColor = 'var(--accent)';
                    e.currentTarget.style.background = 'var(--surface-hover)';
                  }}
                  onMouseLeave={(e) => {
                    if (!canCreateTemplate) {
                      return;
                    }
                    e.currentTarget.style.borderColor = 'var(--border-subtle)';
                    e.currentTarget.style.background = 'var(--card-bg)';
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                    {section.title}
                  </span>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {item.roleTagRows.flat().map((tag, i) => (
                      <span
                        key={`${tag.label}-${i}`}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          minHeight: 18,
                          padding: '0 6px',
                          borderRadius: 999,
                          background: `${tag.color}15`,
                          color: tag.color,
                          fontSize: 9,
                          fontWeight: 700,
                        }}
                      >
                        {tag.label}
                      </span>
                    ))}
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.4 }}>
                    {item.description}
                  </span>
                </button>
              )),
            )}
          </div>
        )}
      </section>

      {/* New template button */}
      <button
        type="button"
        onClick={onNewTemplate}
        disabled={!canCreateTemplate}
        style={{
          minHeight: 34,
          borderRadius: 10,
          border: '1px dashed color-mix(in oklch, var(--border) 40%, transparent)',
          color: 'var(--text-3)',
          background: 'var(--surface)',
          fontSize: 12,
          fontWeight: 600,
          cursor: canCreateTemplate ? 'pointer' : 'not-allowed',
          transition: 'all 0.15s',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          opacity: canCreateTemplate ? 1 : 0.6,
        }}
        onMouseEnter={(e) => {
          if (!canCreateTemplate) {
            return;
          }
          e.currentTarget.style.background = 'var(--surface-hover)';
          e.currentTarget.style.color = 'var(--text-2)';
          e.currentTarget.style.borderColor = 'var(--accent)';
        }}
        onMouseLeave={(e) => {
          if (!canCreateTemplate) {
            return;
          }
          e.currentTarget.style.background = 'var(--surface)';
          e.currentTarget.style.color = 'var(--text-3)';
          e.currentTarget.style.borderColor = 'color-mix(in oklch, var(--border) 40%, transparent)';
        }}
      >
        <PlusIcon size={12} color="currentColor" />
        {canCreateTemplate ? '新建团队模板' : '模板持久化开发中'}
      </button>
    </div>
  );
}
