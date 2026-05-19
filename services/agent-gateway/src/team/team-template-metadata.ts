import {
  FIXED_TEAM_CORE_ROLE_BINDINGS,
  FIXED_TEAM_CORE_ROLE_ORDER,
  type TeamCoreRole,
} from '@openAwork/shared';

export type TeamTemplateRole = TeamCoreRole;

export interface TeamTemplateRoleBinding {
  agentId: string;
  modelId?: string;
  providerId?: string;
  variant?: string;
}

export type TeamTemplateDefaultBindings = Record<TeamTemplateRole, TeamTemplateRoleBinding>;

export const REQUIRED_TEAM_TEMPLATE_ROLES = FIXED_TEAM_CORE_ROLE_ORDER;

export function buildFixedTeamTemplateDefaultBindings(): TeamTemplateDefaultBindings {
  const bindings: Partial<TeamTemplateDefaultBindings> = {};
  for (const role of REQUIRED_TEAM_TEMPLATE_ROLES) {
    bindings[role] = { agentId: FIXED_TEAM_CORE_ROLE_BINDINGS[role] };
  }
  return bindings as TeamTemplateDefaultBindings;
}

export function findMissingTeamTemplateDefaultBindingRoles(
  defaultBindings?: Partial<Record<TeamTemplateRole, TeamTemplateRoleBinding | string>>,
): TeamTemplateRole[] {
  return REQUIRED_TEAM_TEMPLATE_ROLES.filter((role) => {
    const binding = defaultBindings?.[role];
    if (typeof binding === 'string') {
      return binding.trim().length === 0;
    }
    if (typeof binding === 'object' && binding !== null) {
      return !binding.agentId || binding.agentId.trim().length === 0;
    }
    return true;
  });
}
