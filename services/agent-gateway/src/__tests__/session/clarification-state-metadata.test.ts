import { describe, expect, it } from 'vitest';
import {
  applyAnswer,
  buildConfirmNode,
  CONFIRM_NODE_ID,
  createGrillState,
  serializeGrillState,
} from '@openAwork/agent-core';
import { validateSessionMetadataPatch } from '../../session/session-workspace-metadata.js';

function validClarificationState(): string {
  return serializeGrillState(
    createGrillState([
      {
        id: 'goal',
        dimension: 'goal',
        question: '目标是什么？',
        options: [{ label: '改单文件', recommended: true }],
        dependsOn: [],
      },
      buildConfirmNode(['goal']),
    ]),
  );
}

function rejectedClarificationState(): string {
  const pending = applyAnswer(
    createGrillState([
      {
        id: 'goal',
        dimension: 'goal',
        question: '目标是什么？',
        options: [{ label: '改单文件', recommended: true }],
        dependsOn: [],
      },
      buildConfirmNode(['goal']),
    ]),
    'goal',
    '改单文件',
  );
  return serializeGrillState(applyAnswer(pending, CONFIRM_NODE_ID, '需修改'));
}

describe('session metadata: clarificationState', () => {
  it('接受合法的 GrillState 序列化字符串', () => {
    const result = validateSessionMetadataPatch({ clarificationState: validClarificationState() });
    expect(result.success).toBe(true);
  });

  it('与 dialogueMode 可共存', () => {
    const result = validateSessionMetadataPatch({
      clarificationState: validClarificationState(),
      dialogueMode: 'clarify',
    });
    expect(result.success).toBe(true);
  });

  it('字段可选：缺失时仍通过', () => {
    expect(validateSessionMetadataPatch({ dialogueMode: 'clarify' }).success).toBe(true);
  });

  it('拒绝非法 JSON 字符串', () => {
    expect(validateSessionMetadataPatch({ clarificationState: '{not json' }).success).toBe(false);
  });

  it('拒绝结构不符的 JSON（缺 nodes）', () => {
    expect(
      validateSessionMetadataPatch({
        clarificationState: JSON.stringify({ round: 0, history: [] }),
      }).success,
    ).toBe(false);
  });

  it('拒绝非字符串类型', () => {
    expect(validateSessionMetadataPatch({ clarificationState: { nodes: [] } }).success).toBe(false);
  });

  it('接受带 rejections 的 GrillState（新字段可选且可被解析）', () => {
    const result = validateSessionMetadataPatch({
      clarificationState: rejectedClarificationState(),
    });
    expect(result.success).toBe(true);
  });

  it('拒绝 rejections 结构不符的 JSON', () => {
    expect(
      validateSessionMetadataPatch({
        clarificationState: JSON.stringify({
          nodes: [],
          round: 0,
          history: [],
          rejections: [{ at: 1 }],
        }),
      }).success,
    ).toBe(false);
  });

  it('拒绝 exhaustedAt 类型错误的 JSON', () => {
    expect(
      validateSessionMetadataPatch({
        clarificationState: JSON.stringify({ nodes: [], round: 0, history: [], exhaustedAt: 'x' }),
      }).success,
    ).toBe(false);
  });
});
