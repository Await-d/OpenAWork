import type { SharedSessionDetailRecord, SharedSessionSummaryRecord } from '@openAwork/web-client';

export function resolveSelectedSharedSummary(input: {
  selectedTeamId: string | null;
  snapshotSharedSessions: SharedSessionSummaryRecord[];
  sharedSessions: SharedSessionSummaryRecord[];
  selectedSharedSessionShare?: SharedSessionDetailRecord['share'] | null;
  selectedSharedSessionId: string | null;
}): SharedSessionSummaryRecord | null {
  if (input.selectedTeamId != null) {
    return (
      input.snapshotSharedSessions.find((session) => session.sessionId === input.selectedTeamId) ??
      input.sharedSessions.find((session) => session.sessionId === input.selectedTeamId) ??
      null
    );
  }

  return (
    input.selectedSharedSessionShare ??
    input.snapshotSharedSessions.find(
      (session) => session.sessionId === input.selectedSharedSessionId,
    ) ??
    input.sharedSessions.find((session) => session.sessionId === input.selectedSharedSessionId) ??
    input.snapshotSharedSessions[0] ??
    input.sharedSessions[0] ??
    null
  );
}

export function resolveActiveSharedSession(input: {
  selectedTeamId: string | null;
  selectedSharedSession: SharedSessionDetailRecord | null;
}): SharedSessionDetailRecord | null {
  if (input.selectedTeamId != null) {
    return input.selectedSharedSession?.share.sessionId === input.selectedTeamId
      ? input.selectedSharedSession
      : null;
  }

  return input.selectedSharedSession;
}

export function resolveMatchedSharedSummary(input: {
  selectedTeamId: string | null;
  activeSharedSession: SharedSessionDetailRecord | null;
  selectedSharedSession: SharedSessionDetailRecord | null;
  sharedSessions: SharedSessionSummaryRecord[];
}): SharedSessionSummaryRecord | null {
  if (input.selectedTeamId == null) {
    return null;
  }

  return (
    (input.activeSharedSession?.share?.sessionId === input.selectedTeamId
      ? input.activeSharedSession.share
      : null) ??
    (input.selectedSharedSession?.share?.sessionId === input.selectedTeamId
      ? input.selectedSharedSession.share
      : null) ??
    input.sharedSessions.find((session) => session.sessionId === input.selectedTeamId) ??
    null
  );
}

export function resolveMatchedSharedSessionDetail(input: {
  selectedTeamId: string | null;
  activeSharedSession: SharedSessionDetailRecord | null;
  selectedSharedSession: SharedSessionDetailRecord | null;
}): SharedSessionDetailRecord | null {
  if (input.selectedTeamId == null) {
    return null;
  }

  const activeMatches = input.activeSharedSession?.share?.sessionId === input.selectedTeamId;
  if (activeMatches) {
    return input.activeSharedSession;
  }

  const selectedMatches = input.selectedSharedSession?.share?.sessionId === input.selectedTeamId;
  if (selectedMatches) {
    return input.selectedSharedSession;
  }

  // 兼容测试桩或过渡态：只有单个详情对象且缺少 share 元数据时，保守回退到该对象。
  if (
    input.activeSharedSession &&
    input.activeSharedSession.share == null &&
    !input.selectedSharedSession
  ) {
    return input.activeSharedSession;
  }

  if (
    input.selectedSharedSession &&
    input.selectedSharedSession.share == null &&
    !input.activeSharedSession
  ) {
    return input.selectedSharedSession;
  }

  return null;
}
