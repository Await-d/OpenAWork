import { describe, expect, it } from 'vitest';
import { inferReviewVerdictFromText } from '../../handoff/capability/completion-protocol-contract.js';
import { normalizeReviewOutput } from '../../handoff/workflow/review-output-normalization.js';

describe('review output normalization', () => {
  it('Given PASS/ISSUE 格式 When normalizeReviewOutput Then 保留结构化结论', () => {
    expect(normalizeReviewOutput('PASS\n', inferReviewVerdictFromText)).toEqual({
      passed: true,
      issues: [],
    });
    expect(normalizeReviewOutput('ISSUE: AC-1 — 缺少覆盖', inferReviewVerdictFromText)).toEqual({
      passed: false,
      issues: ['AC-1 — 缺少覆盖'],
    });
  });

  it('Given 简短通过总结 When normalizeReviewOutput Then 识别为通过', () => {
    expect(normalizeReviewOutput('检查完成，未发现问题。', inferReviewVerdictFromText)).toEqual({
      passed: true,
      issues: [],
    });
  });

  it('Given 含糊总结 When normalizeReviewOutput Then 不冒充通过', () => {
    expect(normalizeReviewOutput('已查看。', inferReviewVerdictFromText)).toEqual({
      passed: false,
      issues: ['评审未给出明确结论：已查看。'],
    });
  });
});
