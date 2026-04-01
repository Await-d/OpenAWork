import { describe, expect, it } from 'vitest';
import {
  buildExitPlanModeQuestionInput,
  EXIT_PLAN_MODE_APPROVE_LABEL,
  EXIT_PLAN_MODE_CONTINUE_LABEL,
  shouldExitPlanModeFromAnswers,
} from '../plan-mode-tools.js';

describe('plan-mode tools helpers', () => {
  it('builds a plan approval question with approve and continue options', () => {
    expect(
      buildExitPlanModeQuestionInput({
        plan: '1. Inspect gateway\n2. Update contracts',
      }),
    ).toEqual({
      questions: [
        {
          question:
            'Do you approve this plan and want implementation to start now?\n\n1. Inspect gateway\n2. Update contracts',
          header: 'Plan approval',
          multiple: false,
          options: [
            {
              label: EXIT_PLAN_MODE_APPROVE_LABEL,
              description: 'Approve the plan and let the session leave plan mode.',
            },
            {
              label: EXIT_PLAN_MODE_CONTINUE_LABEL,
              description: 'Keep plan mode active and continue refining the plan.',
            },
          ],
        },
      ],
    });
  });

  it('only exits plan mode when the approve label is selected', () => {
    expect(shouldExitPlanModeFromAnswers([[EXIT_PLAN_MODE_APPROVE_LABEL]])).toBe(true);
    expect(shouldExitPlanModeFromAnswers([[EXIT_PLAN_MODE_CONTINUE_LABEL]])).toBe(false);
    expect(shouldExitPlanModeFromAnswers([])).toBe(false);
  });
});
