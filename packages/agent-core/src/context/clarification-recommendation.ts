import type { ClarificationNodeOption } from './clarification-tree.js';

export function findRecommendedOption(
  options: readonly ClarificationNodeOption[],
): ClarificationNodeOption | undefined {
  return options.find((option) => option.recommended === true);
}

export function normalizeRecommendedOptions(
  options: readonly ClarificationNodeOption[],
): ClarificationNodeOption[] {
  const firstRecommended = options.findIndex((option) => option.recommended === true);

  return options.map((option, index) => {
    if (option.recommended !== true) {
      return { ...option };
    }
    return { ...option, recommended: index === firstRecommended };
  });
}
