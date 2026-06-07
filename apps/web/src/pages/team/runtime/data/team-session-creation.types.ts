import { DEFAULT_FIXED_TEAM_MEMBER_SLOTS, FIXED_TEAM_CORE_ROLE_BINDINGS } from '@openAwork/shared';
import type { FixedTeamMemberSlot } from '@openAwork/shared';

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
  memberSlots: FixedTeamMemberSlot[];
  optionalAgentIds: string[];
  requiredRoleBindings: Partial<Record<RequiredCoreRole, string>>;
  source: TeamSessionCreationSource;
  teamWorkspaceId: string;
  title: string;
  workingDirectory: string | null;
}

export interface TeamSessionCreationFieldErrors {
  optionalAgentIds?: string | null;
  title?: string | null;
}

export function createBlankTeamSessionDraft(
  teamWorkspaceId: string,
  memberSlots: FixedTeamMemberSlot[] = DEFAULT_FIXED_TEAM_MEMBER_SLOTS,
  workingDirectory: string | null = null,
): TeamSessionCreationDraft {
  return {
    defaultProvider: null,
    memberSlots: memberSlots.map((slot) => ({ ...slot, toolsets: [...slot.toolsets] })),
    optionalAgentIds: [],
    requiredRoleBindings: { ...FIXED_TEAM_CORE_ROLE_BINDINGS },
    source: { kind: 'blank' },
    teamWorkspaceId,
    title: '',
    workingDirectory,
  };
}
