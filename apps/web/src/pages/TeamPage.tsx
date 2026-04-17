import { useNavigate, useParams } from 'react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createTeamClient } from '@openAwork/web-client';
import type { AgentTeamsSidebarTeam, AgentTeamsTabKey } from './team/runtime/team-runtime-types.js';
import {
  TeamRuntimeReferenceDataProvider,
  useTeamRuntimeReferenceViewData,
  useResolvedTeamRuntimeReferenceData,
} from './team/runtime/team-runtime-reference-data.js';
import { SHELL_BACKGROUND } from './team/runtime/team-runtime-shared.js';
import { TopTeamHeader } from './team/runtime/TopTeamHeader.js';
import { TabRow } from './team/runtime/TabRow.js';
import { FooterBar, MainWorkspace } from './team/runtime/MainWorkspace.js';
import { NewTeamSessionModal } from './team/runtime/NewTeamSessionModal.js';
import { NewTeamTemplateModal } from './team/runtime/NewTeamTemplateModal.js';
import { SessionSidebar } from './team/runtime/TeamSessionSidebar.js';
import { useTeamWorkspaceSnapshotState } from './team/use-team-workspace-snapshot-state.js';
import { useTeamWorkspaceState } from './team/use-team-workspace-state.js';
import { useAuthStore } from '../stores/auth.js';
import type { TeamSessionCreationDraft } from './team/runtime/team-session-creation.types.js';

function TeamPageLayout({
  activeWorkspaceId,
  activeWorkspaceName,
  onRefreshSnapshot,
  onRefreshWorkspaces,
  pendingCreatedSessionId,
  selectedTeamId,
  setPendingCreatedSessionId,
  setSelectedTeamId,
}: {
  activeWorkspaceId: string | null;
  activeWorkspaceName: string;
  onRefreshSnapshot: () => void;
  onRefreshWorkspaces: () => void;
  pendingCreatedSessionId: string | null;
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
  const [viewMode, setViewMode] = useState(1);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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

  const handleSelectAgent = useCallback((id: string) => {
    setSelectedAgentId((previous) => (previous === id ? '' : id));
  }, []);

  const handleTogglePause = useCallback(() => {
    if (!canToggleSelectedTeam || !selectedTeamId || !selectedTeam) {
      return;
    }
    void data.toggleSessionState(selectedTeamId, selectedTeam.status);
  }, [canToggleSelectedTeam, data.toggleSessionState, selectedTeam, selectedTeamId]);

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
      <MainWorkspace
        activeTab={activeTab}
        selectedTeam={selectedTeam}
        selectedAgentId={selectedAgentId}
        onSelectAgent={handleSelectAgent}
        onNewTemplate={handleOpenTemplate}
      />
    ),
    [activeTab, handleOpenTemplate, handleSelectAgent, selectedAgentId, selectedTeam],
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
          <TabRow activeTab={activeTab} onSelect={setActiveTab} />
          <div
            style={{
              minHeight: 0,
              overflow: 'auto',
              background:
                'linear-gradient(180deg, var(--surface) 0%, color-mix(in srgb, var(--surface) 96%, var(--bg)) 100%)',
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
        pendingCreatedSessionId={pendingCreatedSessionId}
        selectedTeamId={selectedTeamId}
        setPendingCreatedSessionId={setPendingCreatedSessionId}
        setSelectedTeamId={setSelectedTeamId}
      />
    </TeamRuntimeReferenceDataProvider>
  );
}
