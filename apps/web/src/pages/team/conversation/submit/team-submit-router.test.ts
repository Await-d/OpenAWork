/**
 * team-submit-router · D5 提交策略路由测试
 *
 * 覆盖 `resolveTeamSubmitStrategy` 这条纯函数边界，确认 (roleLayer, substate)
 * 组合按 D5 决策路由到 stream 或 inbound。组件层的真流式 / 滚动管理 / Q-P
 * 回复由 useTeamConversationState v0.3 的集成测试覆盖。
 */

import { describe, expect, it } from 'vitest';
import { resolveTeamSubmitStrategy } from './team-submit-router.js';

describe('resolveTeamSubmitStrategy (D5)', () => {
  it('routes clarifying substate to inbound clarification_answer regardless of layer', () => {
    expect(resolveTeamSubmitStrategy('reception', 'clarifying')).toEqual({
      kind: 'inbound',
      messageType: 'clarification_answer',
    });
    expect(resolveTeamSubmitStrategy('pm1', 'clarifying')).toEqual({
      kind: 'inbound',
      messageType: 'clarification_answer',
    });
    expect(resolveTeamSubmitStrategy(null, 'clarifying')).toEqual({
      kind: 'inbound',
      messageType: 'clarification_answer',
    });
  });

  it('routes reception (non-clarifying) to stream — the b agent runs as a chat-style LLM loop', () => {
    expect(resolveTeamSubmitStrategy('reception', null)).toEqual({ kind: 'stream' });
    expect(resolveTeamSubmitStrategy('reception', 'idle')).toEqual({ kind: 'stream' });
    expect(resolveTeamSubmitStrategy('reception', 'drafting_spec')).toEqual({ kind: 'stream' });
  });

  it('routes pm1 / pm2 / executor / reviewer (non-clarifying) to stream', () => {
    for (const layer of ['pm1', 'pm2', 'executor', 'reviewer']) {
      expect(resolveTeamSubmitStrategy(layer, null)).toEqual({ kind: 'stream' });
      expect(resolveTeamSubmitStrategy(layer, 'idle')).toEqual({ kind: 'stream' });
    }
  });

  it('falls through to stream for unknown roleLayer / substate combos', () => {
    expect(resolveTeamSubmitStrategy(null, null)).toEqual({ kind: 'stream' });
    expect(resolveTeamSubmitStrategy('unexpected-layer', 'unexpected-substate')).toEqual({
      kind: 'stream',
    });
  });
});
