import { useNavigate, useParams } from 'react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createTeamClient } from '@openAwork/web-client';
// 团队页专属样式（含 team-* hover 工具类）— V1 fallback 也加载
import './runtime/styles/team-runtime.css';
import type {
  AgentTeamsSidebarTeam,
  AgentTeamsTabKey,
} from './runtime/data/team-runtime-types.js';
import {
  TeamRuntimeReferenceDataProvider,
  useTeamRuntimeReferenceViewData,
  useResolvedTeamRuntimeReferenceData,
} from './runtime/data/team-runtime-reference-data.js';
import { SHELL_BACKGROUND } from './runtime/shared/team-runtime-shared.js';
import { TopTeamHeader } from './runtime/shell/header/TopTeamHeader.js';
import { TabRow } from './runtime/shell/controls/TabRow.js';
import { FooterBar, MainWorkspace } from './runtime/shell/header/MainWorkspace.js';
import { NewTeamSessionModal } from './runtime/shell/modals/NewTeamSessionModal.js';
import { NewTeamTemplateModal } from './runtime/shell/modals/NewTeamTemplateModal.js';
import { LayerConversationDrawer } from './runtime/shell/session-view/LayerConversationDrawer.js';
import { PauseConfirmDialog, ResumeStaleDialog } from './runtime/shell/controls/PauseResumeControls.js';
import { SessionTreeView } from './runtime/tabs/tasks/SessionTreeView.js';
import { TeamArtifactSection } from './runtime/tabs/tasks/TeamArtifactSection.js';
import { SessionSidebar } from './runtime/shell/sidebar/TeamSessionSidebar.js';
import { TeamStatusBar } from './runtime/shell/header/TeamStatusBar.js';
import { useTeamWorkspaceSnapshotState } from './hooks/use-team-workspace-snapshot-state.js';
import { useTeamWorkspaceState } from './hooks/use-team-workspace-state.js';
import { useAuthStore } from '../../stores/auth/auth.js';
import { connectTeamEvents, disconnectTeamEvents, useHandoffStore } from '../../stores/team/team-events.js';
import type { TeamSessionCreationDraft } from './runtime/data/team-session-creation.types.js';

function TeamPageLayout({
  activeWorkspaceId,
  activeWorkspaceName,
  onRefreshSnapshot,
  onRefreshWorkspaces,
  selectedTeamId,
  setPendingCreatedSessionId,
  setSelectedTeamId,
}: {
  activeWorkspaceId: string | null;
  activeWorkspaceName: string;
  onRefreshSnapshot: () => void;
  onRefreshWorkspaces: () => void;
  selectedTeamId: string;
  setPendingCreatedSessionId: (teamId: string | null) => void;
  setSelectedTeamId: (teamId: string) => void;
}) {
  const data = useTeamRuntimeReferenceViewData();
  const { accessToken, gatewayUrl } = useAuthStore();
  const [activeTab, setActiveTab] = useState<AgentTeamsTabKey>('office');
  const [selectedAgentId, setSelectedAgentId] = useState(data.defaultSelectedAgentId);
  const [showNewSessionModal, setShowNewSessionModal] = useState(false);
  const [showNewTemplateModal, setShowNewTemplateModal] = useState(false);
  const [showPauseConfirm, setShowPauseConfirm] = useState(false);
  const [showResumeStale, setShowResumeStale] = useState(false);
  const [showLayerDrawer, setShowLayerDrawer] = useState(false);
  const [viewMode, setViewMode] = useState(1);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const teamEventsConnectionGeneration = useRef(0);
  const handoffs = useHandoffStore((state) => state.handoffs);

  useEffect(() => {
    if (!gatewayUrl || !accessToken) {
      return undefined;
    }

    teamEventsConnectionGeneration.current += 1;
    const generation = teamEventsConnectionGeneration.current;
    connectTeamEvents(gatewayUrl, accessToken);
    return () => {
      disconnectTeamEvents();
      window.setTimeout(() => {
        if (teamEventsConnectionGeneration.current === generation) {
          disconnectTeamEvents();
        }
      }, 0);
      window.setTimeout(() => {
        if (teamEventsConnectionGeneration.current === generation) {
          disconnectTeamEvents();
        }
      }, 100);
    };
  }, [accessToken, gatewayUrl]);

  useEffect(() => {
    if (!data.roleChips.some((chip) => chip.id === selectedAgentId)) {
      setSelectedAgentId(data.defaultSelectedAgentId);
    }
  }, [data.defaultSelectedAgentId, data.roleChips, selectedAgentId]);

  const selectedTeam = useMemo<AgentTeamsSidebarTeam | null>(() => {
    return (
      data.workspaceGroups
        .flatMap((group) => group.sessions)
        .find((session) => session.id === selectedTeamId) ?? null
    );
  }, [data.workspaceGroups, selectedTeamId]);

  const isSelectedTeamPaused = useMemo(() => {
    if (!selectedTeam) {
      return data.topSummary.status === '已暂停';
    }

    return selectedTeam.status !== 'running';
  }, [data.topSummary.status, selectedTeam]);

  const canToggleSelectedTeam =
    data.canManageRuntime &&
    selectedTeam != null &&
    selectedTeam.status !== 'completed' &&
    selectedTeam.status !== 'failed';

  const hasHandoffs = handoffs.size > 0;

  const hasActivePm1Handoff = useMemo(() => {
    for (const handoff of handoffs.values()) {
      if (
        handoff.toRoleLayer === 'pm1' &&
        (handoff.state === 'pending' || handoff.state === 'claimed' || handoff.state === 'running')
      ) {
        return true;
      }
    }
    return false;
  }, [handoffs]);

  const activeHandoffCount = useMemo(() => {
    let count = 0;
    for (const handoff of handoffs.values()) {
      if (
        handoff.state === 'pending' ||
        handoff.state === 'claimed' ||
        handoff.state === 'running'
      ) {
        count += 1;
      }
    }
    return count;
  }, [handoffs]);

  const staleHandoffCount = useMemo(() => {
    let count = 0;
    for (const handoff of handoffs.values()) {
      if (handoff.state === 'pending' || handoff.state === 'claimed') {
        count += 1;
      }
    }
    return count;
  }, [handoffs]);

  const handleSelectAgent = useCallback((id: string) => {
    setSelectedAgentId((previous) => (previous === id ? '' : id));
  }, []);

  const handleTogglePause = useCallback(() => {
    if (!canToggleSelectedTeam || !selectedTeamId || !selectedTeam) {
      return;
    }
    void data.toggleSessionState(selectedTeamId, selectedTeam.status);
  }, [canToggleSelectedTeam, data.toggleSessionState, selectedTeam, selectedTeamId]);

  const handlePauseAll = useCallback(() => {
    if (!canToggleSelectedTeam || isSelectedTeamPaused) {
      return;
    }
    setShowPauseConfirm(true);
  }, [canToggleSelectedTeam, isSelectedTeamPaused]);

  const handleConfirmPauseAll = useCallback(() => {
    setShowPauseConfirm(false);
    if (!canToggleSelectedTeam || isSelectedTeamPaused || !selectedTeamId || !selectedTeam) {
      return;
    }
    void data.toggleSessionState(selectedTeamId, selectedTeam.status);
  }, [
    canToggleSelectedTeam,
    data.toggleSessionState,
    isSelectedTeamPaused,
    selectedTeam,
    selectedTeamId,
  ]);

  const handleResumeAll = useCallback(() => {
    setShowResumeStale(false);
    if (!canToggleSelectedTeam || !isSelectedTeamPaused || !selectedTeamId || !selectedTeam) {
      return;
    }
    void data.toggleSessionState(selectedTeamId, selectedTeam.status);
  }, [
    canToggleSelectedTeam,
    data.toggleSessionState,
    isSelectedTeamPaused,
    selectedTeam,
    selectedTeamId,
  ]);

  const handleRequestResumeAll = useCallback(() => {
    if (staleHandoffCount > 0) {
      setShowResumeStale(true);
      return;
    }
    handleResumeAll();
  }, [handleResumeAll, staleHandoffCount]);

  const handleSelectLayerSession = useCallback(() => {
    setShowLayerDrawer(true);
  }, []);

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
    [data, setSelectedTeamId],
  );

  const handleSubmitDraft = useCallback(
    async (draft: TeamSessionCreationDraft) => {
      if (!accessToken || !gatewayUrl || !activeWorkspaceId) {
        throw new Error('未登录，无法创建团队会话');
      }

      const client = createTeamClient(gatewayUrl);
      const session = await client.createSession(accessToken, activeWorkspaceId, {
        title: draft.title.trim() || undefined,
        source: draft.source,
        optionalAgentIds: draft.optionalAgentIds,
        defaultProvider: draft.defaultProvider,
      });

      onRefreshWorkspaces();
      onRefreshSnapshot();
      setPendingCreatedSessionId(session.id);
      setSelectedTeamId(session.id);
      data.selectTeam(session.id);
    },
    [
      accessToken,
      activeWorkspaceId,
      data,
      gatewayUrl,
      onRefreshSnapshot,
      onRefreshWorkspaces,
      setPendingCreatedSessionId,
      setSelectedTeamId,
    ],
  );

  const mainContent = useMemo(
    () => (
      <div style={{ display: 'grid', gap: 12 }}>
        <MainWorkspace
          activeTab={activeTab}
          selectedTeam={selectedTeam}
          selectedAgentId={selectedAgentId}
          onSelectAgent={handleSelectAgent}
          onNewTemplate={handleOpenTemplate}
        />
        {hasActivePm1Handoff ? (
          <div style={{ padding: '0 20px 16px' }}>
            <TeamArtifactSection />
          </div>
        ) : null}
        {activeTab === 'tasks' && !hasActivePm1Handoff ? (
          <div style={{ padding: '0 20px 16px' }}>
            <SessionTreeView onSelectSession={handleSelectLayerSession} />
          </div>
        ) : null}
      </div>
    ),
    [
      activeTab,
      handleOpenTemplate,
      handleSelectAgent,
      handleSelectLayerSession,
      hasActivePm1Handoff,
      selectedAgentId,
      selectedTeam,
    ],
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
        {!sidebarCollapsed && (
          <SessionSidebar
            onOpenNewSessionModal={() => setShowNewSessionModal(true)}
            selectedTeamId={selectedTeamId}
            onSelectTeam={handleSelectTeam}
            onNewTemplate={handleOpenTemplate}
            onCollapse={() => setSidebarCollapsed(true)}
          />
        )}

        <div
          style={{
            minHeight: '100dvh',
            display: 'grid',
            gridTemplateRows: 'auto auto 1fr 30px',
            overflow: 'auto',
          }}
        >
          <TopTeamHeader
            selectedTeam={selectedTeam}
            selectedAgentId={selectedAgentId}
            onSelectAgent={handleSelectAgent}
            isPaused={isSelectedTeamPaused}
            onTogglePause={handleTogglePause}
            canManageRuntime={canToggleSelectedTeam}
            onExpandSidebar={sidebarCollapsed ? () => setSidebarCollapsed(false) : undefined}
          />
          {hasHandoffs || showPauseConfirm || showResumeStale ? (
            <div style={{ display: 'grid', gap: 8, padding: '8px 16px 0' }}>
              {hasHandoffs ? (
                <div
                  onClick={(event) => {
                    if (event.target instanceof HTMLElement && event.target.closest('button')) {
                      return;
                    }
                    setShowLayerDrawer(true);
                  }}
                >
                  <TeamStatusBar
                    onPauseAll={canToggleSelectedTeam ? handlePauseAll : undefined}
                    onResumeAll={canToggleSelectedTeam ? handleRequestResumeAll : undefined}
                    paused={isSelectedTeamPaused}
                  />
                </div>
              ) : null}
              <PauseConfirmDialog
                open={showPauseConfirm}
                activeCount={activeHandoffCount}
                onConfirm={handleConfirmPauseAll}
                onCancel={() => setShowPauseConfirm(false)}
              />
              <ResumeStaleDialog
                open={showResumeStale}
                staleCount={staleHandoffCount}
                onResumeAll={handleResumeAll}
                onDismiss={() => setShowResumeStale(false)}
              />
            </div>
          ) : null}
          <TabRow activeTab={activeTab} onSelect={setActiveTab} />
          <div
            style={{
              minHeight: 0,
              overflow: 'auto',
              background:
                'linear-gradient(180deg, var(--bg-overlay) 0%, color-mix(in srgb, var(--bg-overlay) 96%, var(--bg-base) 100%)',
            }}
          >
            {mainContent}
          </div>
          <FooterBar activeTab={activeTab} viewMode={viewMode} onViewModeChange={setViewMode} />
        </div>
      </div>
      {showNewTemplateModal && data.canCreateTemplate && (
        <NewTeamTemplateModal onClose={() => setShowNewTemplateModal(false)} />
      )}
      {showNewSessionModal && data.canCreateSession && activeWorkspaceId && (
        <NewTeamSessionModal
          onClose={() => setShowNewSessionModal(false)}
          onSubmitDraft={handleSubmitDraft}
          teamWorkspaceId={activeWorkspaceId}
          workspaceLabel={activeWorkspaceName}
        />
      )}
      <LayerConversationDrawer visible={showLayerDrawer} />
    </div>
  );
}

export default function TeamPage() {
  const { teamWorkspaceId } = useParams<{ teamWorkspaceId?: string }>();
  const navigate = useNavigate();
  const workspaceState = useTeamWorkspaceState(teamWorkspaceId);
  const resolvedTeamWorkspaceId = teamWorkspaceId ?? workspaceState.workspaces[0]?.id ?? null;
  const workspaceSnapshotState = useTeamWorkspaceSnapshotState(
    resolvedTeamWorkspaceId ?? undefined,
  );
  const [pendingCreatedSessionId, setPendingCreatedSessionId] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState('');

  // Auto-navigate to first workspace when visiting /team without an ID
  useEffect(() => {
    if (!teamWorkspaceId && !workspaceState.loading && resolvedTeamWorkspaceId) {
      void navigate(`/team/${resolvedTeamWorkspaceId}`, { replace: true });
    }
  }, [navigate, resolvedTeamWorkspaceId, teamWorkspaceId, workspaceState.loading]);

  const data = useResolvedTeamRuntimeReferenceData({
    activeWorkspace: workspaceState.activeWorkspace,
    collaborationEnabled: Boolean(resolvedTeamWorkspaceId),
    teamWorkspaceId: resolvedTeamWorkspaceId,
    activeWorkspaceSnapshot: workspaceSnapshotState.snapshot,
    selectedTeamId,
    workspaceSnapshotError: workspaceSnapshotState.error,
    workspaceSnapshotLoading: workspaceSnapshotState.loading,
    workspaceError: workspaceState.error,
    workspaceLoading: workspaceState.loading,
    workspaces: workspaceState.workspaces,
    onWorkspacesChanged: workspaceState.refresh,
  });

  useEffect(() => {
    if (!selectedTeamId) {
      setSelectedTeamId(data.defaultSelectedTeamId);
      return;
    }

    const exists = data.workspaceGroups.some((group) =>
      group.sessions.some((session) => session.id === selectedTeamId),
    );
    if (exists && pendingCreatedSessionId === selectedTeamId) {
      setPendingCreatedSessionId(null);
    }
    if (!exists && pendingCreatedSessionId === selectedTeamId) {
      return;
    }
    if (!exists) {
      setSelectedTeamId(data.defaultSelectedTeamId);
    }
  }, [data.defaultSelectedTeamId, data.workspaceGroups, pendingCreatedSessionId, selectedTeamId]);

  return (
    <TeamRuntimeReferenceDataProvider value={data}>
      <TeamPageLayout
        activeWorkspaceId={workspaceState.activeWorkspace?.id ?? null}
        activeWorkspaceName={workspaceState.activeWorkspace?.name ?? '当前工作区'}
        onRefreshSnapshot={workspaceSnapshotState.refresh}
        onRefreshWorkspaces={workspaceState.refresh}
        selectedTeamId={selectedTeamId}
        setPendingCreatedSessionId={setPendingCreatedSessionId}
        setSelectedTeamId={setSelectedTeamId}
      />
    </TeamRuntimeReferenceDataProvider>
  );
}
