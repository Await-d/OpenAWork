import { describe, expect, it } from 'vitest';
import { isQuestionToolName, shouldSuppressQuestionToolCall } from './question-tool-suppression.js';

describe('isQuestionToolName', () => {
  it('命中网关工具名与模型侧显示名，且大小写 / 首尾空白归一', () => {
    expect(isQuestionToolName('question')).toBe(true);
    expect(isQuestionToolName('AskUserQuestion')).toBe(true);
    expect(isQuestionToolName('ASKUSERQUESTION')).toBe(true);
    expect(isQuestionToolName('  question  ')).toBe(true);
  });

  it('非提问工具一律不命中（避免误伤 todowrite / read 等单行 pill）', () => {
    expect(isQuestionToolName('todowrite')).toBe(false);
    expect(isQuestionToolName('read')).toBe(false);
    expect(isQuestionToolName('')).toBe(false);
  });
});

/**
 * 显隐裁决的核心断言：等待回答期间严格不渲染，任何已结算信号都必须恢复可见。
 * 「结算后必须可见」是历史可追溯性的硬约束——历史会话里没有 pending 面板，
 * 这条只读问答条目是用户回看「当时问了什么、答了什么」的唯一依据。
 */
describe('shouldSuppressQuestionToolCall', () => {
  it('等待回答（running / paused / 状态未知，且未结算）→ 隐藏', () => {
    expect(shouldSuppressQuestionToolCall({ toolName: 'question', status: 'running' })).toBe(true);
    expect(shouldSuppressQuestionToolCall({ toolName: 'question', status: 'paused' })).toBe(true);
    expect(shouldSuppressQuestionToolCall({ toolName: 'AskUserQuestion' })).toBe(true);
  });

  it('入参还没收全（空 input、无 status）也隐藏 —— 否则会先闪一张骨架卡', () => {
    expect(shouldSuppressQuestionToolCall({ toolName: 'question' })).toBe(true);
  });

  it('有 output（已回答 / 已跳过）→ 可见', () => {
    expect(
      shouldSuppressQuestionToolCall({
        toolName: 'question',
        status: 'completed',
        output: '用哪种方案?="方案 A"',
      }),
    ).toBe(false);
  });

  it('isError → 可见', () => {
    expect(
      shouldSuppressQuestionToolCall({ toolName: 'question', status: 'failed', isError: true }),
    ).toBe(false);
  });

  it('completed / failed 但结果被裁剪（无 output）→ 仍可见，不允许从历史里消失', () => {
    expect(shouldSuppressQuestionToolCall({ toolName: 'question', status: 'completed' })).toBe(
      false,
    );
    expect(shouldSuppressQuestionToolCall({ toolName: 'question', status: 'failed' })).toBe(false);
  });

  it('非提问工具永不被隐藏', () => {
    expect(shouldSuppressQuestionToolCall({ toolName: 'read', status: 'running' })).toBe(false);
    expect(shouldSuppressQuestionToolCall({ toolName: 'bash' })).toBe(false);
  });
});
