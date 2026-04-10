import { useEffect, useMemo, useState } from 'react';
import type {
  SharedSessionDetailRecord,
  SharedSessionSummaryRecord,
  TeamAuditLogRecord,
  TeamMemberRecord,
  TeamMessageRecord,
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
} from './team-runtime-model.js';

interface TeamRuntimeProjectionInput {
  auditLogs: TeamAuditLogRecord[];
  members: TeamMemberRecord[];
  messages: TeamMessageRecord[];
  onSelectSharedSession: (sessionId: string) => void;
  selectedSharedSession: SharedSessionDetailRecord | null;
  selectedSharedSessionId: string | null;
  sessionShares: TeamSessionShareRecord[];
  sessions: Array<{ id: string; title: string | null; workspacePath: string | null }>;
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

  return {
    activeAgentCount,
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
    selectedWorkspaceKey,
    setSelectedWorkspaceKey,
    workspaceOutputCards,
    workspaceOverviewLines,
    workspaceSummaries,
  };
}
