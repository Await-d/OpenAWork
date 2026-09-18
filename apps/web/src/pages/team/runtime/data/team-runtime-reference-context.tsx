import { createContext, useContext, type ReactNode } from 'react';
import { EMPTY_VIEW_DATA } from './team-runtime-reference-empty.js';
import type { TeamRuntimeReferenceViewData } from './team-runtime-reference-types.js';

const TeamRuntimeReferenceDataContext = createContext<TeamRuntimeReferenceViewData | null>(null);

export function TeamRuntimeReferenceDataProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: TeamRuntimeReferenceViewData;
}) {
  return (
    <TeamRuntimeReferenceDataContext value={value}>{children}</TeamRuntimeReferenceDataContext>
  );
}

export function useTeamRuntimeReferenceViewData(): TeamRuntimeReferenceViewData {
  return useContext(TeamRuntimeReferenceDataContext) ?? EMPTY_VIEW_DATA;
}
