import { FIXED_TEAM_CORE_ROLE_BINDINGS } from '@openAwork/shared';

export type TeamSourceKind = 'blank' | 'saved-template';

export type RequiredCoreRole = 'planner' | 'researcher' | 'executor' | 'reviewer';

export type TeamSessionCreationStep = 'source' | 'required-roles' | 'optional-members' | 'review';

export const REQUIRED_CORE_ROLES: RequiredCoreRole[] = [
  'planner',
  'researcher',
  'executor',
  'reviewer',
];

export interface TeamSessionCreationSource {
  kind: TeamSourceKind;
  templateId?: string;
}

export interface TeamSessionCreationDraft {
  defaultProvider: string | null;
  optionalAgentIds: string[];
  requiredRoleBindings: Partial<Record<RequiredCoreRole, string>>;
  source: TeamSessionCreationSource;
  teamWorkspaceId: string;
  title: string;
}

export interface TeamSessionCreationFieldErrors {
  optionalAgentIds?: string | null;
  title?: string | null;
}

export function createBlankTeamSessionDraft(teamWorkspaceId: string): TeamSessionCreationDraft {
  return {
    defaultProvider: null,
    optionalAgentIds: [],
    requiredRoleBindings: { ...FIXED_TEAM_CORE_ROLE_BINDINGS },
    source: { kind: 'blank' },
    teamWorkspaceId,
    title: '',
  };
}
