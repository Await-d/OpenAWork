import {
  FROZEN_CATEGORY_DESCRIPTIONS,
  FROZEN_CATEGORY_PROMPT_APPENDS,
} from './reference-frozen/category-snapshot.js';

export function getTaskCategoryDescription(category: string | undefined): string | undefined {
  if (!category) {
    return undefined;
  }
  return FROZEN_CATEGORY_DESCRIPTIONS[category];
}

export function getTaskCategoryPromptAppend(category: string | undefined): string | undefined {
  if (!category) {
    return undefined;
  }
  return FROZEN_CATEGORY_PROMPT_APPENDS[category]?.trim();
}
