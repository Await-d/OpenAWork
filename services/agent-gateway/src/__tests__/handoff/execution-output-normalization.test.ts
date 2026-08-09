import { describe, expect, it } from 'vitest';
import { inferExecutionSummaryVerdict } from '../../handoff/workflow/execution-output-normalization.js';

describe('execution output normalization', () => {
  it('Given 明确完成总结 When inferExecutionSummaryVerdict Then 识别为 pass', () => {
    expect(inferExecutionSummaryVerdict('已完成订单表单实现并通过检查。')).toBe('pass');
  });

  it('Given 明确修复总结 When inferExecutionSummaryVerdict Then 识别为 pass', () => {
    expect(inferExecutionSummaryVerdict('已修复 Team 页面任务概览。')).toBe('pass');
  });

  it('Given 明确阻塞总结 When inferExecutionSummaryVerdict Then 识别为 blocked', () => {
    expect(inferExecutionSummaryVerdict('当前被依赖阻塞，尚未验证。')).toBe('blocked');
  });

  it('Given 含糊总结 When inferExecutionSummaryVerdict Then 识别为 unknown', () => {
    expect(inferExecutionSummaryVerdict('已做一些调整。')).toBe('unknown');
  });
});
