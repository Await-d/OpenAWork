import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AgentTeamsTabKey } from './team-runtime-reference-mock.js';
import { useTeamRuntimeReferenceViewData } from './team-runtime-reference-data.js';
import { SHELL_BACKGROUND } from './team-runtime-shared.js';
import { TopTeamHeader } from './TopTeamHeader.js';
import { TabRow } from './TabRow.js';
import { MainWorkspace, FooterBar } from './MainWorkspace.js';
import { NewTeamTemplateModal } from './NewTeamTemplateModal.js';
import { SessionSidebar } from './TeamSessionSidebar.js';

export function TeamRuntimeReferencePage() {
  const data = useTeamRuntimeReferenceViewData();
  const [activeTab, setActiveTab] = useState<AgentTeamsTabKey>('office');
  const [selectedAgentId, setSelectedAgentId] = useState(data.defaultSelectedAgentId);
  const [isPaused, setIsPaused] = useState(data.topSummary.status === '已暂停');
  const [showNewTemplateModal, setShowNewTemplateModal] = useState(false);
  const [runningSeconds, setRunningSeconds] = useState(1001);
  const [viewMode, setViewMode] = useState(1);
  const [selectedTeamId, setSelectedTeamId] = useState(data.defaultSelectedTeamId);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setRunningSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!data.roleChips.some((chip) => chip.id === selectedAgentId)) {
      setSelectedAgentId(data.defaultSelectedAgentId);
    }
  }, [data.defaultSelectedAgentId, data.roleChips, selectedAgentId]);

  useEffect(() => {
    if (!selectedTeamId) {
      setSelectedTeamId(data.defaultSelectedTeamId);
      return;
    }

    const exists = data.workspaceGroups.some((group) =>
      group.sessions.some((session) => session.id === selectedTeamId),
    );
    if (!exists) {
      setSelectedTeamId(data.defaultSelectedTeamId);
    }
  }, [data.defaultSelectedTeamId, data.workspaceGroups, selectedTeamId]);

  useEffect(() => {
    setIsPaused(data.topSummary.status === '已暂停');
  }, [data.topSummary.status]);

  const handleSelectAgent = useCallback((id: string) => {
    setSelectedAgentId((prev) => (prev === id ? '' : id));
  }, []);

  const handleTogglePause = useCallback(() => {
    if (!data.canManageRuntime) {
      return;
    }
    setIsPaused((prev) => !prev);
  }, [data.canManageRuntime]);

  const handleOpenTemplate = useCallback(() => {
    if (!data.canCreateTemplate) {
      return;
    }
    setShowNewTemplateModal(true);
  }, [data.canCreateTemplate]);

  const handleSelectTeam = useCallback(
    (teamId: string) => {
      setSelectedTeamId(teamId);
      data.selectTeam(teamId);
    },
    [data],
  );

  const mainContent = useMemo(
    () => (
      <MainWorkspace
        activeTab={activeTab}
        selectedAgentId={selectedAgentId}
        onSelectAgent={handleSelectAgent}
        onNewTemplate={handleOpenTemplate}
      />
    ),
    [activeTab, handleOpenTemplate, selectedAgentId, handleSelectAgent],
  );

  return (
    <div className="page-root" style={{ background: SHELL_BACKGROUND, minHeight: '100dvh' }}>
      <div
        style={{
          minHeight: '100dvh',
          fontFamily:
            'Inter, "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei", sans-serif',
          display: 'grid',
          gridTemplateColumns: sidebarCollapsed ? '1fr' : '260px 1fr',
          transition: 'grid-template-columns 0.2s ease',
        }}
      >
        {/* Left sidebar */}
        {!sidebarCollapsed && (
          <SessionSidebar
            onCreateSession={(workspacePath) => {
              void data.createSession(workspacePath);
            }}
            selectedTeamId={selectedTeamId}
            onSelectTeam={handleSelectTeam}
            onNewTemplate={handleOpenTemplate}
            onCollapse={() => setSidebarCollapsed(true)}
          />
        )}

        {/* Main area */}
        <div
          style={{
            minHeight: '100dvh',
            display: 'grid',
            gridTemplateRows: 'auto auto 1fr 30px',
            overflow: 'auto',
          }}
        >
          <TopTeamHeader
            selectedAgentId={selectedAgentId}
            onSelectAgent={handleSelectAgent}
            isPaused={isPaused}
            onTogglePause={handleTogglePause}
            canManageRuntime={data.canManageRuntime}
            onExpandSidebar={sidebarCollapsed ? () => setSidebarCollapsed(false) : undefined}
          />
          <TabRow activeTab={activeTab} onSelect={setActiveTab} />
          <div
            style={{
              minHeight: 0,
              overflow: 'auto',
              background:
                'linear-gradient(180deg, var(--surface) 0%, color-mix(in srgb, var(--surface) 96%, var(--bg)) 100%)',
            }}
          >
            {(data.activeMode === 'live' || data.loading || data.error || data.feedback) && (
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  padding: '10px 16px 0',
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    minHeight: 24,
                    padding: '0 10px',
                    borderRadius: 999,
                    background:
                      data.activeMode === 'live'
                        ? 'color-mix(in oklch, var(--success) 12%, transparent)'
                        : 'color-mix(in oklch, var(--accent) 12%, transparent)',
                    color: data.activeMode === 'live' ? 'var(--success)' : 'var(--accent)',
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {data.activeMode === 'live' ? '已接入真实 Team Runtime' : '参考 Mock 模式'}
                </span>
                {data.loading ? (
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    正在同步团队运行数据…
                  </span>
                ) : null}
                {data.error ? (
                  <span style={{ fontSize: 11, color: 'var(--danger)' }}>{data.error}</span>
                ) : null}
                {data.feedback ? (
                  <span
                    style={{
                      fontSize: 11,
                      color: data.feedback.tone === 'success' ? 'var(--success)' : 'var(--warning)',
                    }}
                  >
                    {data.feedback.message}
                  </span>
                ) : null}
              </div>
            )}
            {mainContent}
          </div>
          <FooterBar
            runningSeconds={runningSeconds}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />
        </div>
      </div>
      {showNewTemplateModal && data.canCreateTemplate && (
        <NewTeamTemplateModal onClose={() => setShowNewTemplateModal(false)} />
      )}
    </div>
  );
}
