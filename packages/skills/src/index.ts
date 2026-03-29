export { SkillRegistry } from './registry.js';
export type {
  InstalledSkill,
  SkillInstallResult,
  PermissionGrantResult,
  PermissionGrantHandler,
} from './registry.js';
export { BUILTIN_SKILLS } from './builtins.js';
export type { BuiltinSkillDef } from './builtins.js';

import { SkillRegistry } from './registry.js';

export function createDefaultSkillRegistry(): SkillRegistry {
  return new SkillRegistry();
}
