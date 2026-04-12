import { useState, useCallback, useMemo } from 'react';
import type { AgentTeamsSidebarTeam } from './team-runtime-reference-mock.js';
import { useTeamRuntimeReferenceViewData } from './team-runtime-reference-data.js';
import {
  PlusIcon,
  TemplateIcon,
  CollapseLeftIcon,
  ChevronRightIcon,
  FolderIcon,
  TrashIcon,
  PauseIcon,
  ResumeIcon,
} from './TeamIcons.js';

const STATUS_META: Record<string, { color: string; label: string; pulse?: boolean }> = {
  running: { color: 'var(--success)', label: '运行中', pulse: true },
  paused: { color: 'var(--warning)', label: '已暂停' },
  completed: { color: 'var(--text-3)', label: '已完成' },
  failed: { color: 'var(--danger)', label: '失败' },
};

function SidebarSessionRow({
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
  onSelect: (id: string) => void;
  onTogglePause: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const meta = STATUS_META[team.status] ?? STATUS_META.completed!;

  return (
    <button
      type="button"
      onClick={() => onSelect(team.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        appearance: 'none',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        borderRadius: 7,
        padding: '6px 8px 6px 10px',
        background: isSelected
          ? 'color-mix(in oklch, var(--accent) 10%, transparent)'
          : hovered
            ? 'var(--surface-hover)'
            : 'transparent',
        cursor: 'pointer',
        transition: 'background 0.15s, box-shadow 0.15s',
        border: 'none',
        borderLeft: `3px solid ${meta.color}`,
        boxShadow: isSelected
          ? `inset 0 0 0 1px color-mix(in oklch, var(--accent) 25%, transparent)`
          : hovered
            ? `inset 0 0 0 1px var(--border-subtle)`
            : 'none',
        textAlign: 'left',
      }}
    >
      {/* Top row: status dot + title + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
        {/* Status dot */}
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: meta.color,
            flexShrink: 0,
            boxShadow: meta.pulse ? `0 0 4px ${meta.color}` : 'none',
            animation: meta.pulse ? 'dot-pulse 2s ease-in-out infinite' : 'none',
          }}
        />
        {/* Title */}
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            fontWeight: isSelected ? 600 : 400,
            color: 'var(--text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            lineHeight: 1.4,
          }}
        >
          {team.title}
        </span>
        {/* Hover actions */}
        {allowManage && hovered && (
          <span style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
            {team.status !== 'completed' && team.status !== 'failed' && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePause(team.id);
                }}
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 4,
                  cursor: 'pointer',
                  padding: '1px 3px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  transition: 'border-color 0.15s',
                }}
                title={team.status === 'running' ? '暂停' : '恢复'}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = meta.color;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-subtle)';
                }}
              >
                {team.status === 'running' ? (
                  <PauseIcon size={9} color="var(--warning)" />
                ) : (
                  <ResumeIcon size={9} color="var(--success)" />
                )}
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(team.id);
              }}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 4,
                cursor: 'pointer',
                padding: '1px 3px',
                display: 'inline-flex',
                alignItems: 'center',
                transition: 'border-color 0.15s',
              }}
              title="删除"
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--danger)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-subtle)';
              }}
            >
              <TrashIcon size={9} color="var(--danger)" />
            </button>
          </span>
        )}
      </div>
      {/* Bottom row: subtitle + status label */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          marginTop: 2,
          paddingLeft: 12,
        }}
      >
        <span
          style={{
            flex: 1,
            fontSize: 10,
            color: 'var(--text-3)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            lineHeight: 1.3,
          }}
        >
          {team.subtitle}
        </span>
        <span
          style={{
            fontSize: 9,
            color: meta.color,
            flexShrink: 0,
            fontWeight: 500,
          }}
        >
          {meta.label}
        </span>
      </div>
    </button>
  );
}

export function SessionSidebar({
  onCreateSession,
  selectedTeamId,
  onSelectTeam,
  onNewTemplate,
  onCollapse,
}: {
  onCreateSession?: (workspacePath?: string | null) => void;
  selectedTeamId: string;
  onSelectTeam: (id: string) => void;
  onNewTemplate: () => void;
  onCollapse: () => void;
}) {
  const {
    canCreateSession,
    canCreateTemplate,
    canManageSessionEntries,
    runningTeams,
    sidebarSections,
    templateCount,
    templateError,
    templateLoading,
    workspaceGroups,
  } = useTeamRuntimeReferenceViewData();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [sessionSearch, setSessionSearch] = useState('');
  const [pausedSessionIds, setPausedSessionIds] = useState<Set<string>>(new Set());
  const [deletedSessionIds, setDeletedSessionIds] = useState<Set<string>>(new Set());

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const togglePauseSession = useCallback((id: string) => {
    setPausedSessionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const deleteSession = useCallback((id: string) => {
    setDeletedSessionIds((prev) => new Set(prev).add(id));
  }, []);

  const getEffectiveStatus = (team: AgentTeamsSidebarTeam) => {
    if (pausedSessionIds.has(team.id)) return 'paused' as const;
    return team.status;
  };

  const filteredGroups = useMemo(() => {
    const base = workspaceGroups.map((group) => ({
      ...group,
      sessions: group.sessions.filter((s) => !deletedSessionIds.has(s.id)),
    }));
    if (!sessionSearch.trim()) return base.filter((g) => g.sessions.length > 0);
    const q = sessionSearch.toLowerCase();
    return base
      .map((group) => ({
        ...group,
        sessions: group.sessions.filter(
          (s) => s.title.toLowerCase().includes(q) || s.subtitle.toLowerCase().includes(q),
        ),
      }))
      .filter((group) => group.sessions.length > 0);
  }, [deletedSessionIds, sessionSearch, workspaceGroups]);

  const totalSessionCount =
    workspaceGroups.reduce((n, g) => n + g.sessions.length, 0) - deletedSessionIds.size;
  const selectedWorkspacePath =
    workspaceGroups.find((group) => group.sessions.some((session) => session.id === selectedTeamId))
      ?.workspacePath ?? null;

  return (
    <aside
      style={{
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid var(--border-subtle)',
        background: 'var(--bg)',
        overflow: 'hidden',
      }}
    >
      <style>{`
        @keyframes dot-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>

      {/* ── Top action bar ──────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          padding: '8px 8px 6px',
          flexShrink: 0,
          alignItems: 'center',
        }}
      >
        <button
          type="button"
          onClick={() => onCreateSession?.(selectedWorkspacePath)}
          title="新建团队会话"
          disabled={!canCreateSession}
          style={{
            display: 'flex',
            flex: 1,
            height: 30,
            padding: '0 10px',
            alignItems: 'center',
            gap: 6,
            borderRadius: 7,
            background: 'var(--accent)',
            border: 'none',
            color: 'var(--accent-text)',
            cursor: canCreateSession ? 'pointer' : 'not-allowed',
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            minWidth: 0,
            justifyContent: 'center',
            opacity: canCreateSession ? 1 : 0.55,
            transition: 'opacity 0.15s, filter 0.15s',
          }}
        >
          <PlusIcon size={12} color="var(--accent-text)" />
          新建会话
        </button>
        <button
          type="button"
          title="收起面板"
          onClick={onCollapse}
          style={{
            display: 'flex',
            width: 30,
            height: 30,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 7,
            color: 'var(--text-3)',
            background: 'transparent',
            border: '1px solid transparent',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'background 0.15s, border-color 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--surface)';
            e.currentTarget.style.borderColor = 'var(--border-subtle)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.borderColor = 'transparent';
          }}
        >
          <CollapseLeftIcon size={12} color="var(--text-3)" />
        </button>
      </div>

      {/* ── Search ──────────────────────────────────────────────────── */}
      <div
        style={{
          padding: '0 8px 6px',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            background: 'var(--surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 7,
            padding: '0 8px',
            transition: 'border-color 0.15s, box-shadow 0.15s',
          }}
        >
          <span style={{ color: 'var(--text-3)', fontSize: 12, flexShrink: 0 }}>⌕</span>
          <input
            type="text"
            placeholder="搜索会话…"
            value={sessionSearch}
            onChange={(e) => setSessionSearch(e.target.value)}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              padding: '5px 0',
              fontSize: 11,
              color: 'var(--text)',
              outline: 'none',
              minWidth: 0,
            }}
            onFocus={(e) => {
              const p = e.currentTarget.parentElement!;
              p.style.borderColor = 'var(--accent)';
              p.style.boxShadow = '0 0 0 2px color-mix(in oklch, var(--accent) 15%, transparent)';
            }}
            onBlur={(e) => {
              const p = e.currentTarget.parentElement!;
              p.style.borderColor = 'var(--border-subtle)';
              p.style.boxShadow = 'none';
            }}
          />
          {sessionSearch && (
            <button
              type="button"
              onClick={() => setSessionSearch('')}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                color: 'var(--text-3)',
                fontSize: 11,
                lineHeight: 1,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* ── Scrollable content: sessions + templates ────────────────── */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* ── Sessions section ────────────────────────────────────── */}
        <div style={{ padding: '0 6px 4px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* Section header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '2px 4px 4px',
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: 'var(--text-2)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              会话
            </span>
            <span
              style={{
                flex: 1,
                height: 1,
                background: 'var(--border-subtle)',
              }}
            />
            <span
              style={{
                fontSize: 9,
                color: 'var(--text-3)',
              }}
            >
              {totalSessionCount}
            </span>
          </div>

          {filteredGroups.length === 0 && (
            <p
              style={{
                padding: '16px 8px',
                textAlign: 'center',
                fontSize: 11,
                color: 'var(--text-3)',
              }}
            >
              暂无匹配会话
            </p>
          )}
          {filteredGroups.map((group) => {
            const groupKey = group.workspacePath ?? '__unbound__';
            const isCollapsed = collapsedGroups.has(groupKey);
            return (
              <div key={groupKey} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {/* Workspace group header */}
                <button
                  type="button"
                  onClick={() => toggleGroup(groupKey)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    minWidth: 0,
                    padding: '5px 6px',
                    borderRadius: 6,
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    color: 'var(--text-2)',
                    textAlign: 'left',
                    transition: 'background 0.15s',
                    width: '100%',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--surface-hover)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                      transition: 'transform 150ms ease',
                      display: 'inline-flex',
                      alignItems: 'center',
                    }}
                  >
                    <ChevronRightIcon size={8} color="var(--text-3)" />
                  </span>
                  <FolderIcon size={11} color="var(--text-3)" />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 10,
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {group.workspaceLabel}
                  </span>
                  <span
                    style={{
                      fontSize: 9,
                      color: 'var(--text-3)',
                      flexShrink: 0,
                      padding: '0 5px',
                      borderRadius: 999,
                      background: 'var(--surface)',
                      lineHeight: '16px',
                    }}
                  >
                    {group.sessions.length}
                  </span>
                </button>

                {/* Session rows */}
                {!isCollapsed &&
                  group.sessions.map((team) => (
                    <SidebarSessionRow
                      allowManage={canManageSessionEntries}
                      key={team.id}
                      team={{ ...team, status: getEffectiveStatus(team) }}
                      isSelected={selectedTeamId === team.id}
                      onSelect={onSelectTeam}
                      onTogglePause={togglePauseSession}
                      onDelete={deleteSession}
                    />
                  ))}
              </div>
            );
          })}
        </div>

        {/* ── Templates section (below sessions) ──────────────────── */}
        <div
          style={{
            padding: '6px 6px 4px',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            borderTop: '1px solid var(--border-subtle)',
            marginTop: 4,
          }}
        >
          {/* Section header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 4px 2px',
            }}
          >
            <TemplateIcon size={10} color="var(--text-3)" />
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: 'var(--text-2)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              模板
            </span>
            <span
              style={{
                flex: 1,
                height: 1,
                background: 'var(--border-subtle)',
              }}
            />
            <span
              style={{
                fontSize: 9,
                color: 'var(--text-3)',
              }}
            >
              {templateCount}
            </span>
          </div>

          {templateLoading && (
            <div
              style={{
                padding: '8px 8px',
                fontSize: 10,
                color: 'var(--text-3)',
                textAlign: 'center',
              }}
            >
              正在同步模板…
            </div>
          )}
          {templateError && (
            <div
              style={{
                padding: '8px 10px',
                borderRadius: 7,
                border: '1px solid color-mix(in oklch, var(--danger) 30%, transparent)',
                background: 'color-mix(in oklch, var(--danger) 6%, transparent)',
                color: 'var(--danger)',
                fontSize: 10,
                lineHeight: 1.5,
              }}
            >
              {templateError}
            </div>
          )}
          {!templateLoading && templateCount === 0 && (
            <div
              style={{
                padding: '10px 10px',
                borderRadius: 7,
                border: '1px dashed var(--border-subtle)',
                color: 'var(--text-3)',
                fontSize: 10,
                lineHeight: 1.5,
                textAlign: 'center',
              }}
            >
              暂无模板，点击新建创建
            </div>
          )}
          {sidebarSections.map((section) =>
            section.items.map((item) => (
              <button
                type="button"
                key={item.id}
                style={{
                  appearance: 'none',
                  padding: '7px 9px',
                  borderRadius: 7,
                  background: 'var(--surface)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  cursor: canCreateTemplate ? 'pointer' : 'not-allowed',
                  transition: 'background 0.15s, border-color 0.15s, box-shadow 0.15s',
                  border: '1px solid var(--border-subtle)',
                  opacity: canCreateTemplate ? 1 : 0.6,
                  textAlign: 'left',
                }}
                onClick={canCreateTemplate ? onNewTemplate : undefined}
                disabled={!canCreateTemplate}
                onMouseEnter={(e) => {
                  if (!canCreateTemplate) return;
                  e.currentTarget.style.borderColor =
                    'color-mix(in oklch, var(--accent) 40%, transparent)';
                  e.currentTarget.style.background = 'var(--surface-hover)';
                  e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)';
                }}
                onMouseLeave={(e) => {
                  if (!canCreateTemplate) return;
                  e.currentTarget.style.borderColor = 'var(--border-subtle)';
                  e.currentTarget.style.background = 'var(--surface)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <span
                  style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', lineHeight: 1.3 }}
                >
                  {item.title || section.title}
                </span>
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                  {item.roleTagRows.flat().map((tag, i) => (
                    <span
                      key={`${tag.label}-${i}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        minHeight: 15,
                        padding: '0 5px',
                        borderRadius: 999,
                        background: `color-mix(in oklch, ${tag.color} 12%, transparent)`,
                        color: tag.color,
                        fontSize: 8,
                        fontWeight: 600,
                      }}
                    >
                      {tag.label}
                    </span>
                  ))}
                </div>
                {item.description && (
                  <span style={{ fontSize: 9, color: 'var(--text-3)', lineHeight: 1.4 }}>
                    {item.description}
                  </span>
                )}
              </button>
            )),
          )}
        </div>
      </div>

      {/* ── Bottom status ────────────────────────────────────────────── */}
      <div
        style={{
          padding: '5px 10px',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
          background: 'color-mix(in oklch, var(--bg) 95%, var(--surface))',
        }}
      >
        <span style={{ fontSize: 9, color: 'var(--text-3)' }}>
          活跃 <strong style={{ color: 'var(--success)' }}>{runningTeams.length}</strong>
          {' / '}共 {totalSessionCount}
        </span>
        {runningTeams.length > 0 && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              fontSize: 9,
              color: 'var(--success)',
            }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                background: 'var(--success)',
                animation: 'dot-pulse 2s ease-in-out infinite',
              }}
            />
            运行中
          </span>
        )}
      </div>
    </aside>
  );
}
