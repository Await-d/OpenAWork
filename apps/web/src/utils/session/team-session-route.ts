interface TeamSessionRouteGroup {
  readonly sessions: ReadonlyArray<{ readonly id: string }>;
}

export function buildTeamSessionRoute(teamWorkspaceId: string, sessionId: string): string {
  return `/team/${encodeURIComponent(teamWorkspaceId)}?sessionId=${encodeURIComponent(sessionId)}`;
}

export function resolveTeamSessionFromRoute(input: {
  readonly defaultSessionId: string;
  readonly groups: readonly TeamSessionRouteGroup[];
  readonly requestedSessionId: string | null;
}): string | null {
  const requestedSessionId = input.requestedSessionId?.trim() ?? '';
  if (requestedSessionId) {
    const requestedSessionExists = input.groups.some((group) =>
      group.sessions.some((session) => session.id === requestedSessionId),
    );
    if (requestedSessionExists) {
      return requestedSessionId;
    }
  }

  if (!input.defaultSessionId) {
    return null;
  }

  return input.groups.some((group) =>
    group.sessions.some((session) => session.id === input.defaultSessionId),
  )
    ? input.defaultSessionId
    : null;
}
