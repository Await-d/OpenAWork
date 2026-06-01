/**
 * 260515-team-phase-a · Phase 4 内容入口
 *
 * 集中导出宪法预置模板（T-11）与默认五层 SOUL（T-12）。
 */

export {
  CONSTITUTION_TEMPLATES,
  findConstitutionTemplate,
  type ConstitutionTemplate,
} from './constitution-templates.js';

export {
  DEFAULT_SOULS,
  DEFAULT_SOUL_VERSION,
  LEGACY_DEFAULT_SOUL_FINGERPRINTS,
  SOUL_ROLE_LAYER_ORDER,
  findDefaultSoul,
  type DefaultSoul,
  type SoulRoleLayer,
} from './soul-defaults.js';
