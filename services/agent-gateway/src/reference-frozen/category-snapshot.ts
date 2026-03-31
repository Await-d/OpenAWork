export const FROZEN_CATEGORY_DESCRIPTIONS: Record<string, string> = {
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

export const FROZEN_CATEGORY_PROMPT_APPENDS: Record<string, string> = {
  'visual-engineering':
    '<Category_Context>\nYou are working on VISUAL/UI tasks. Analyze the design system first and align spacing, color, typography, and motion with the existing product language.\n</Category_Context>',
  ultrabrain:
    '<Category_Context>\nYou are working on DEEP LOGICAL REASONING / COMPLEX ARCHITECTURE tasks. Favor simple, maintainable solutions and explicit trade-offs.\n</Category_Context>',
  deep: '<Category_Context>\nYou are working on GOAL-ORIENTED AUTONOMOUS tasks. Explore thoroughly before acting and execute end-to-end without unnecessary check-ins.\n</Category_Context>',
  artistry:
    '<Category_Context>\nYou are working on HIGHLY CREATIVE / ARTISTIC tasks. Push beyond conventional patterns while keeping the result coherent.\n</Category_Context>',
  quick:
    '<Category_Context>\nYou are working on SMALL / QUICK tasks. Be direct, minimal, and explicit.\n</Category_Context>',
  'unspecified-low':
    '<Category_Context>\nYou are working on an uncategorized moderate-effort task. Keep the scope contained and the outcome concrete.\n</Category_Context>',
  'unspecified-high':
    '<Category_Context>\nYou are working on an uncategorized high-effort task. Be thorough and explicit about broad-impact changes.\n</Category_Context>',
  writing:
    '<Category_Context>\nYou are working on WRITING / PROSE tasks. Optimize for clarity, structure, and human-sounding prose.\n</Category_Context>',
};
