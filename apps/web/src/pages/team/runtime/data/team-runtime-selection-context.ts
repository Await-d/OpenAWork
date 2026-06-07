import type { TeamRuntimeSessionRecord } from '@openAwork/web-client';

export function resolveSelectedRuntimeScopeSessionId(input: {
  selectedTeamId: string | null;
  sessions: Array<Pick<TeamRuntimeSessionRecord, 'id'>>;
}): string | null {
  if (!input.selectedTeamId) {
    return null;
  }

  return input.sessions.some((session) => session.id === input.selectedTeamId)
    ? input.selectedTeamId
    : null;
}
