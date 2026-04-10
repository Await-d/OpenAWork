import { useEffect, useMemo, useState } from 'react';
import type {
  SharedSessionDetailRecord,
  SharedSessionSummaryRecord,
  TeamAuditLogRecord,
  TeamMemberRecord,
  TeamMessageRecord,
  TeamRuntimeSessionRecord,
  TeamSessionShareRecord,
  TeamTaskRecord,
} from '@openAwork/web-client';
import {
  ALL_WORKSPACES_KEY,
  buildRuntimeMetrics,
  buildWorkspaceChangeMetrics,
  buildWorkspaceContextMetrics,
  buildWorkspaceOverviewLines,
  buildWorkspaceOutputCards,
  buildWorkspaceSummaries,
  filterByWorkspace,
  formatWorkspaceLabel,
  getSharedSessionStateLabel,
} from './team-runtime-model.js';
import { groupSessionTreesByWorkspace } from '../../../utils/session-grouping.js';

interface TeamRuntimeProjectionInput {
  auditLogs: TeamAuditLogRecord[];
  members: TeamMemberRecord[];
  messages: TeamMessageRecord[];
  onSelectSharedSession: (sessionId: string) => void;
  selectedSharedSession: SharedSessionDetailRecord | null;
  selectedSharedSessionId: string | null;
  sessionShares: TeamSessionShareRecord[];
  sessions: TeamRuntimeSessionRecord[];
  sharedSessions: SharedSessionSummaryRecord[];
  tasks: TeamTaskRecord[];
}

export function useTeamRuntimeProjection({
  auditLogs,
  members,
  messages,
  onSelectSharedSession,
  selectedSharedSession,
  selectedSharedSessionId,
  sessionShares,
  sessions,
  sharedSessions,
  tasks,
}: TeamRuntimeProjectionInput) {
  const [selectedWorkspaceKey, setSelectedWorkspaceKey] = useState(ALL_WORKSPACES_KEY);

  const memberNameMap = useMemo(
    () => new Map(members.map((member) => [member.id, member.name])),
    [members],
  );

  const workspaceSummaries = useMemo(
    () => buildWorkspaceSummaries({ sessionShares, sessions, sharedSessions }),
    [sessionShares, sessions, sharedSessions],
  );

  useEffect(() => {
    if (workspaceSummaries.some((summary) => summary.key === selectedWorkspaceKey)) {
      return;
    }

    setSelectedWorkspaceKey(workspaceSummaries[0]?.key ?? ALL_WORKSPACES_KEY);
  }, [selectedWorkspaceKey, workspaceSummaries]);

  const selectedWorkspace =
    workspaceSummaries.find((summary) => summary.key === selectedWorkspaceKey) ??
    workspaceSummaries[0] ??
    null;

  const filteredSessions = useMemo(
    () => filterByWorkspace(sessions, selectedWorkspaceKey),
    [selectedWorkspaceKey, sessions],
  );
  const sessionTreeGroups = useMemo(
    () =>
      groupSessionTreesByWorkspace(
        filteredSessions.map((session) => ({
          id: session.id,
          metadata_json: session.metadataJson,
          title: session.title,
          updated_at: session.updatedAt,
        })),
      ),
    [filteredSessions],
  );
  const filteredSessionShares = useMemo(
    () => filterByWorkspace(sessionShares, selectedWorkspaceKey),
    [selectedWorkspaceKey, sessionShares],
  );
  const filteredSharedSessions = useMemo(
    () => filterByWorkspace(sharedSessions, selectedWorkspaceKey),
    [selectedWorkspaceKey, sharedSessions],
  );

  const effectiveSelectedSharedSession = useMemo(() => {
    if (!selectedSharedSessionId) {
      return null;
    }

    if (!filteredSharedSessions.some((session) => session.sessionId === selectedSharedSessionId)) {
      return null;
    }

    return selectedSharedSession;
  }, [filteredSharedSessions, selectedSharedSession, selectedSharedSessionId]);

  useEffect(() => {
    if (filteredSharedSessions.length === 0) {
      return;
    }

    const containsSelected = filteredSharedSessions.some(
      (session) => session.sessionId === selectedSharedSessionId,
    );
    if (!containsSelected) {
      onSelectSharedSession(filteredSharedSessions[0]!.sessionId);
    }
  }, [filteredSharedSessions, onSelectSharedSession, selectedSharedSessionId]);

  const metrics = useMemo(
    () =>
      buildRuntimeMetrics({
        auditLogs,
        selectedSharedSession: effectiveSelectedSharedSession,
        sharedSessions: filteredSharedSessions,
        tasks,
        workspaceSummary: selectedWorkspace,
      }),
    [auditLogs, effectiveSelectedSharedSession, filteredSharedSessions, selectedWorkspace, tasks],
  );

  const workspaceOverviewLines = useMemo(
    () =>
      buildWorkspaceOverviewLines({
        messages,
        selectedSharedSession: effectiveSelectedSharedSession,
        tasks,
        workspaceSummary: selectedWorkspace,
      }),
    [effectiveSelectedSharedSession, messages, selectedWorkspace, tasks],
  );

  const fileChangesSummary = effectiveSelectedSharedSession?.session.fileChangesSummary;
  const activeAgentCount = members.filter((member) => member.status === 'working').length;
  const blockedCount = tasks.filter((task) => task.status === 'failed').length;
  const pendingApprovalCount = effectiveSelectedSharedSession?.pendingPermissions.length ?? 0;
  const pendingQuestionCount = effectiveSelectedSharedSession?.pendingQuestions.length ?? 0;
  const runningCount = selectedWorkspace?.runningCount ?? 0;
  const workspaceLabel = formatWorkspaceLabel(selectedWorkspace?.label ?? null);
  const sessionTitle = effectiveSelectedSharedSession?.share.title ?? null;

  const contextMetrics = useMemo(
    () =>
      buildWorkspaceContextMetrics({
        selectedSharedSession: effectiveSelectedSharedSession,
        sessions: filteredSessions,
        sessionShares: filteredSessionShares,
        sharedSessions: filteredSharedSessions,
      }),
    [
      effectiveSelectedSharedSession,
      filteredSessionShares,
      filteredSessions,
      filteredSharedSessions,
    ],
  );

  const workspaceOutputCards = useMemo(
    () =>
      buildWorkspaceOutputCards({
        selectedSharedSession: effectiveSelectedSharedSession,
        sharedSessions: filteredSharedSessions,
      }),
    [effectiveSelectedSharedSession, filteredSharedSessions],
  );

  const changeMetrics = useMemo(
    () =>
      buildWorkspaceChangeMetrics({
        fileChangesSummary,
        sessions: filteredSessions,
        sharedSessions: filteredSharedSessions,
      }),
    [fileChangesSummary, filteredSessions, filteredSharedSessions],
  );

  const selectedRunSummary = useMemo(() => {
    if (!effectiveSelectedSharedSession) {
      return null;
    }

    return {
      activeViewerCount: effectiveSelectedSharedSession.presence.filter((viewer) => viewer.active)
        .length,
      commentCount: effectiveSelectedSharedSession.comments.length,
      pendingApprovalCount,
      pendingQuestionCount,
      sharedByEmail: effectiveSelectedSharedSession.share.sharedByEmail,
      stateLabel: getSharedSessionStateLabel(effectiveSelectedSharedSession.share.stateStatus),
      title:
        effectiveSelectedSharedSession.share.title ??
        effectiveSelectedSharedSession.share.sessionId,
      workspaceLabel: formatWorkspaceLabel(effectiveSelectedSharedSession.share.workspacePath),
    };
  }, [effectiveSelectedSharedSession, pendingApprovalCount, pendingQuestionCount]);

  const buddyProjection = useMemo(
    () => ({
      activeAgentCount,
      blockedCount,
      pendingApprovalCount,
      pendingQuestionCount,
      runningCount,
      sessionTitle,
      workspaceLabel,
    }),
    [
      activeAgentCount,
      blockedCount,
      pendingApprovalCount,
      pendingQuestionCount,
      runningCount,
      sessionTitle,
      workspaceLabel,
    ],
  );

  return {
    buddyProjection,
    changeMetrics,
    contextMetrics,
    effectiveSelectedSharedSession,
    fileChangesSummary,
    filteredSessions,
    filteredSessionShares,
    filteredSharedSessions,
    memberNameMap,
    metrics,
    selectedWorkspace,
    selectedRunSummary,
    selectedWorkspaceKey,
    setSelectedWorkspaceKey,
    sessionTreeGroups,
    workspaceOutputCards,
    workspaceOverviewLines,
    workspaceSummaries,
  };
}
