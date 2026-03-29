import path from 'node:path';
import { extractNamedTemplate, readReferenceFile } from './agent-reference-parser.js';

const ROOT = '/home/await/project/OpenAWork/temp/oh-my-openagent/src/tools/delegate-task';
const CONSTANTS = readReferenceFile(path.join(ROOT, 'constants.ts'));

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  'visual-engineering': 'Frontend, UI/UX, design, styling, animation',
  ultrabrain:
    'Use ONLY for genuinely hard, logic-heavy tasks. Give clear goals only, not step-by-step instructions.',
  deep: 'Goal-oriented autonomous problem-solving. Thorough research before action. For hairy problems requiring deep understanding.',
  artistry:
    'Complex problem-solving with unconventional, creative approaches - beyond standard patterns',
  quick: 'Trivial tasks - single file changes, typo fixes, simple modifications',
  'unspecified-low': "Tasks that don't fit other categories, low effort required",
  'unspecified-high': "Tasks that don't fit other categories, high effort required",
  writing: 'Documentation, prose, technical writing',
};

const CATEGORY_PROMPT_APPENDS: Record<string, string | undefined> = {
  'visual-engineering': extractNamedTemplate(CONSTANTS, 'VISUAL_CATEGORY_PROMPT_APPEND'),
  ultrabrain: extractNamedTemplate(CONSTANTS, 'ULTRABRAIN_CATEGORY_PROMPT_APPEND'),
  deep: extractNamedTemplate(CONSTANTS, 'DEEP_CATEGORY_PROMPT_APPEND'),
  artistry: extractNamedTemplate(CONSTANTS, 'ARTISTRY_CATEGORY_PROMPT_APPEND'),
  quick: extractNamedTemplate(CONSTANTS, 'QUICK_CATEGORY_PROMPT_APPEND'),
  'unspecified-low': extractNamedTemplate(CONSTANTS, 'UNSPECIFIED_LOW_CATEGORY_PROMPT_APPEND'),
  'unspecified-high': extractNamedTemplate(CONSTANTS, 'UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND'),
  writing: extractNamedTemplate(CONSTANTS, 'WRITING_CATEGORY_PROMPT_APPEND'),
};

export function getTaskCategoryDescription(category: string | undefined): string | undefined {
  if (!category) {
    return undefined;
  }
  return CATEGORY_DESCRIPTIONS[category];
}

export function getTaskCategoryPromptAppend(category: string | undefined): string | undefined {
  if (!category) {
    return undefined;
  }
  return CATEGORY_PROMPT_APPENDS[category]?.trim();
}
