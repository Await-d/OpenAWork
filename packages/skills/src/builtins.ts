import {
  createBuiltinResourceSkillDefs,
  createSystemBuiltinSkillDefs,
} from '@openAwork/resources/node';
import type { SkillManifest, SkillExecutor, ToolResult } from '@openAwork/skill-types';

export interface BuiltinSkillDef {
  manifest: SkillManifest;
  executor: SkillExecutor;
}

const noopExecutor: SkillExecutor = async (): Promise<ToolResult> => {
  return {
    content: 'This is a prompt-based skill. Content is injected via descriptionForModel.',
    isError: false,
  };
};

export const BUILTIN_SKILLS: BuiltinSkillDef[] = [
  ...createSystemBuiltinSkillDefs(noopExecutor),
  ...createBuiltinResourceSkillDefs(noopExecutor),
];
