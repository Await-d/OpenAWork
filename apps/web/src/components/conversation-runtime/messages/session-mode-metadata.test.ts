/**
 * parseSessionModeMetadata 读取的是持久化的 session metadata JSON string，
 * 必须对 undefined / 合法 JSON / 缺字段 / 非法枚举 / 畸形 JSON 给出稳定结果。
 *
 * 注意两个不同的兜底分支（现状）：
 * - `undefined` 输入：不返回 dialogueMode 键；
 * - 解析抛错（含 JSON `null`）：返回带 `dialogueMode: 'clarify'` 的兜底对象。
 */
import { describe, expect, it } from 'vitest';
import type { ReasoningEffort } from './message-model.js';
import { parseSessionModeMetadata } from './session-mode-metadata.js';

describe('parseSessionModeMetadata', () => {
  it('undefined 返回默认值且不携带 dialogueMode 键', () => {
    const result = parseSessionModeMetadata(undefined);

    expect(result).toEqual({
      yoloMode: false,
      webSearchEnabled: true,
      thinkingEnabled: false,
      reasoningEffort: 'medium',
    });
    expect('dialogueMode' in result).toBe(false);
  });

  it('完整 JSON 全部字段透传', () => {
    const result = parseSessionModeMetadata(
      JSON.stringify({
        agentId: 'sisyphus-junior',
        dialogueMode: 'coding',
        yoloMode: true,
        webSearchEnabled: false,
        thinkingEnabled: true,
        reasoningEffort: 'high',
        modelSelectionSource: 'manual',
        providerId: 'openai',
        modelId: 'gpt-5',
      }),
    );

    expect(result).toEqual({
      agentId: 'sisyphus-junior',
      dialogueMode: 'coding',
      yoloMode: true,
      webSearchEnabled: false,
      thinkingEnabled: true,
      reasoningEffort: 'high',
      modelSelectionSource: 'manual',
      providerId: 'openai',
      modelId: 'gpt-5',
    });
  });

  it('合法 JSON 缺字段时回落默认值，dialogueMode 保持 undefined', () => {
    const result = parseSessionModeMetadata('{}');

    expect(result.dialogueMode).toBeUndefined();
    expect(result.agentId).toBeUndefined();
    expect(result.modelSelectionSource).toBeUndefined();
    expect(result.yoloMode).toBe(false);
    expect(result.webSearchEnabled).toBe(true);
    expect(result.thinkingEnabled).toBe(false);
    expect(result.reasoningEffort).toBe('medium');
  });

  it('非法枚举与错误类型被安全归一', () => {
    const result = parseSessionModeMetadata(
      JSON.stringify({
        dialogueMode: 'telepathy',
        agentId: 42,
        yoloMode: 'yes',
        webSearchEnabled: 'no',
        thinkingEnabled: 1,
        reasoningEffort: 'ultra',
        modelSelectionSource: 'guess',
        providerId: null,
      }),
    );

    expect(result.dialogueMode).toBeUndefined();
    expect(result.agentId).toBeUndefined();
    expect(result.yoloMode).toBe(false);
    expect(result.webSearchEnabled).toBe(true);
    expect(result.thinkingEnabled).toBe(false);
    expect(result.reasoningEffort).toBe('medium');
    expect(result.modelSelectionSource).toBeUndefined();
    expect(result.providerId).toBeUndefined();
  });

  it('webSearchEnabled 仅显式 false 才关闭', () => {
    expect(
      parseSessionModeMetadata(JSON.stringify({ webSearchEnabled: false })).webSearchEnabled,
    ).toBe(false);
    expect(
      parseSessionModeMetadata(JSON.stringify({ webSearchEnabled: true })).webSearchEnabled,
    ).toBe(true);
  });

  it('全部 dialogueMode 与 reasoningEffort 取值均可解析', () => {
    for (const dialogueMode of ['clarify', 'coding', 'programmer'] as const) {
      expect(parseSessionModeMetadata(JSON.stringify({ dialogueMode })).dialogueMode).toBe(
        dialogueMode,
      );
    }

    const efforts: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
    for (const reasoningEffort of efforts) {
      expect(parseSessionModeMetadata(JSON.stringify({ reasoningEffort })).reasoningEffort).toBe(
        reasoningEffort,
      );
    }
  });

  it('畸形 JSON 回退到带 dialogueMode=clarify 的兜底对象', () => {
    const result = parseSessionModeMetadata('{oops');

    expect(result).toEqual({
      agentId: undefined,
      dialogueMode: 'clarify',
      yoloMode: false,
      webSearchEnabled: true,
      thinkingEnabled: false,
      reasoningEffort: 'medium',
    });
  });

  it('JSON null 也会落入兜底分支（解析后取字段抛错）', () => {
    expect(parseSessionModeMetadata('null').dialogueMode).toBe('clarify');
  });
});
