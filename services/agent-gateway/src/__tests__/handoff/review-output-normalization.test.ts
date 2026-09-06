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

  it('Given 非空但结论含糊的总结 When normalizeReviewOutput Then 降级放行避免格式型重试', () => {
    for (const result of ['已查看。', '收到', '好的', '知悉', '明白']) {
      expect(normalizeReviewOutput(result, inferReviewVerdictFromText)).toEqual({
        passed: true,
        issues: [],
      });
    }
  });

  it('Given 明确失败语义但未使用 ISSUE 格式 When normalizeReviewOutput Then 仍然拒绝', () => {
    expect(normalizeReviewOutput('检查未通过，存在功能错误。', inferReviewVerdictFromText)).toEqual({
      passed: false,
      issues: ['检查未通过，存在功能错误。'],
    });
  });

  it('Given 含具体发现但结论词未命中 When normalizeReviewOutput Then 不把未知结论当作通过', () => {
    for (const result of [
      'AC-1 缺少实现证据。',
      '发现 SQL 注入漏洞，位置 routes/foo.ts:42。',
      '验收条件尚未满足。',
    ]) {
      const normalized = normalizeReviewOutput(result, inferReviewVerdictFromText);
      expect(normalized.passed).toBe(false);
      expect(normalized.issues.join('\n')).toContain(result);
    }
  });

  it('Given 通过结论包含否定式失败短语 When normalizeReviewOutput Then 不触发格式型退回', () => {
    for (const result of [
      '未发现问题，无需修改。',
      '检查通过，不需要修改。',
      '没有问题，未发现风险。',
      '无需修改。',
      '不需要修改。',
      '未发现风险。',
      '未发现漏洞。',
    ]) {
      expect(normalizeReviewOutput(result, inferReviewVerdictFromText)).toEqual({
        passed: true,
        issues: [],
      });
    }
  });

  it('Given 通过词与明确整改要求冲突 When normalizeReviewOutput Then 仍然拒绝', () => {
    for (const result of [
      '检查通过，但需要修改。',
      '检查通过，但发现鉴权错误。',
      'PASS，但发现严重缺陷。',
      '没有问题，但没有覆盖 AC-2。',
      '未发现问题，但未满足 AC-1。',
    ]) {
      expect(normalizeReviewOutput(result, inferReviewVerdictFromText)).toEqual({
        passed: false,
        issues: [result],
      });
    }
  });

  it('Given 常见否定式安全结论 When normalizeReviewOutput Then 不触发格式型退回', () => {
    for (const result of [
      '暂无风险。',
      '不存在风险。',
      '没有风险。',
      '没风险。',
      '无风险。',
      '未发现漏洞。',
      '不存在漏洞。',
      '没有漏洞。',
      '无安全漏洞。',
    ]) {
      expect(normalizeReviewOutput(result, inferReviewVerdictFromText)).toEqual({
        passed: true,
        issues: [],
      });
    }
  });
});
