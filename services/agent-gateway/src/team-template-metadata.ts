import {
  FIXED_TEAM_CORE_ROLE_BINDINGS,
  FIXED_TEAM_CORE_ROLE_ORDER,
  type TeamCoreRole,
} from '@openAwork/shared';

export type TeamTemplateRole = TeamCoreRole;

export type TeamTemplateDefaultBindings = Record<TeamTemplateRole, string>;

export const REQUIRED_TEAM_TEMPLATE_ROLES = FIXED_TEAM_CORE_ROLE_ORDER;

export function buildFixedTeamTemplateDefaultBindings(): TeamTemplateDefaultBindings {
  return { ...FIXED_TEAM_CORE_ROLE_BINDINGS };
}

export function findMissingTeamTemplateDefaultBindingRoles(
  defaultBindings?: Partial<Record<TeamTemplateRole, string>>,
): TeamTemplateRole[] {
  return REQUIRED_TEAM_TEMPLATE_ROLES.filter((role) => {
    const binding = defaultBindings?.[role];
    return typeof binding !== 'string' || binding.trim().length === 0;
  });
}
