import type {
  SessionTask,
  SharedSessionSummaryRecord,
  TeamRuntimeSessionRecord,
  TeamRuntimeTaskGroupRecord,
} from '@openAwork/web-client';
import type { HandoffEntry } from '../../../../stores/team/team-events.js';
import {
  resolveSessionTreeTeamRuntimeStatus,
  type TeamRuntimeSemanticStatus,
} from './team-runtime-status.js';

export interface CreatedSessionInfo {
  id: string;
  title: string | null;
}

export function buildBaseSessions(
  globalSessions: TeamRuntimeSessionRecord[],
  snapshotSessions: TeamRuntimeSessionRecord[],
  collaborationSessions: TeamRuntimeSessionRecord[],
): TeamRuntimeSessionRecord[] {
  const merged = new Map<string, TeamRuntimeSessionRecord>();
  for (const session of globalSessions) {
    merged.set(session.id, session);
  }
  for (const session of snapshotSessions) {
    merged.set(session.id, session);
  }
  for (const session of collaborationSessions) {
    merged.set(session.id, session);
  }
  return Array.from(merged.values());
}

export function buildEffectiveSessions(
  baseSessions: TeamRuntimeSessionRecord[],
  createdSessionInfo: CreatedSessionInfo | null,
  activeWorkspaceDefaultWorkingRoot: string | null,
): TeamRuntimeSessionRecord[] {
  if (!createdSessionInfo) {
    return baseSessions;
  }
  if (baseSessions.some((s) => s.id === createdSessionInfo.id)) {
    return baseSessions;
  }
  const tempSession: TeamRuntimeSessionRecord = {
    id: createdSessionInfo.id,
    metadataJson: '',
    parentSessionId: null,
    roleLayer: null,
    stateStatus: 'idle',
    title: createdSessionInfo.title ?? '新会话',
    updatedAt: new Date().toISOString(),
    workspacePath: activeWorkspaceDefaultWorkingRoot ?? null,
  };
  return [tempSession, ...baseSessions];
}

export function mergeRuntimeTaskRecords(
  primaryTasks: SessionTask[],
  runtimeTasks: SessionTask[],
): SessionTask[] {
  const deduped = new Map<string, SessionTask>();
  for (const task of primaryTasks) {
    deduped.set(task.id, task);
  }
  for (const task of runtimeTasks) {
    const existing = deduped.get(task.id);
    if (!existing || task.updatedAt > existing.updatedAt) {
      deduped.set(task.id, task);
    }
  }
  return Array.from(deduped.values());
}

export function collectAllRuntimeTasksFromGroups(
  runtimeTaskGroups: TeamRuntimeTaskGroupRecord[],
): SessionTask[] {
  const deduped = new Map<string, SessionTask>();
  for (const group of runtimeTaskGroups) {
    for (const task of group.tasks) {
      const existing = deduped.get(task.id);
      if (!existing || task.updatedAt > existing.updatedAt) {
        deduped.set(task.id, task);
      }
    }
  }
  return Array.from(deduped.values());
}

export function buildRuntimeSessionStatuses(input: {
  sessions: TeamRuntimeSessionRecord[];
  handoffs: HandoffEntry[];
  runtimeTasks: SessionTask[];
}): Map<string, TeamRuntimeSemanticStatus> {
  const statuses = new Map<string, TeamRuntimeSemanticStatus>();
  for (const session of input.sessions) {
    statuses.set(
      session.id,
      resolveSessionTreeTeamRuntimeStatus({
        rootSessionId: session.id,
        paused: session.paused ?? false,
        stateStatus: session.stateStatus,
        sessions: input.sessions,
        handoffs: input.handoffs,
        runtimeTasks: input.runtimeTasks,
      }),
    );
  }
  return statuses;
}

export function buildSharedSessionStatuses(input: {
  sharedSessions: SharedSessionSummaryRecord[];
  sessions: TeamRuntimeSessionRecord[];
  handoffs: HandoffEntry[];
  runtimeTasks: SessionTask[];
}): Map<string, TeamRuntimeSemanticStatus> {
  const statuses = new Map<string, TeamRuntimeSemanticStatus>();
  for (const sharedSession of input.sharedSessions) {
    statuses.set(
      sharedSession.sessionId,
      resolveSessionTreeTeamRuntimeStatus({
        rootSessionId: sharedSession.sessionId,
        stateStatus: sharedSession.stateStatus,
        sessions: input.sessions,
        handoffs: input.handoffs,
        runtimeTasks: input.runtimeTasks,
      }),
    );
  }
  return statuses;
}
