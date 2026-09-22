import { describe, expect, it } from 'vitest';
import type { Message } from '@openAwork/shared';
import {
  buildNormalizedConversationFromHistory,
  buildPreparedUpstreamConversation,
} from '../../session/session-message-store.js';

function syntheticMessage(id: string, text: string, description?: string): Message {
  return {
    id,
    role: 'synthetic',
    content: [{ type: 'text', text }],
    createdAt: Date.now(),
    ...(description ? { description } : {}),
    metadata: { source: 'subagent', childID: 'child-1', agent: 'worker', state: 'completed' },
  };
}

function textMessage(id: string, role: 'user' | 'assistant', text: string): Message {
  return {
    id,
    role,
    content: [{ type: 'text', text }],
    createdAt: Date.now(),
  };
}

describe('legacy normalization keeps synthetic messages', () => {
  it('旧归一化链保留 synthetic 消息并降级为上游 user 角色', () => {
    const normalized = buildNormalizedConversationFromHistory([
      textMessage('user-1', 'user', '真实用户请求'),
      syntheticMessage('synthetic-1', '子代理已完成任务'),
      textMessage('assistant-1', 'assistant', '收到'),
    ]);

    expect(normalized).toEqual([
      { role: 'user', content: '真实用户请求' },
      { role: 'user', content: '子代理已完成任务' },
      { role: 'assistant', content: '收到' },
    ]);
  });

  it('仅含 synthetic 消息的历史不再归一化为空数组', () => {
    const normalized = buildNormalizedConversationFromHistory([
      syntheticMessage('synthetic-only', '通知内容', '任务描述'),
    ]);

    expect(normalized).toEqual([{ role: 'user', content: '通知内容' }]);
  });

  it('buildPreparedUpstreamConversation 链路同样不丢弃 synthetic 消息', () => {
    const prepared = buildPreparedUpstreamConversation(
      [
        textMessage('user-1', 'user', '真实用户请求'),
        syntheticMessage('synthetic-1', '子代理已完成任务'),
      ],
      { contextWindow: 128_000 },
    );

    expect(prepared.normalizedMessages).toEqual([
      { role: 'user', content: '真实用户请求' },
      { role: 'user', content: '子代理已完成任务' },
    ]);
  });

  it('synthetic 文本不受 assistant UI event 过滤影响', () => {
    const uiEventShaped = JSON.stringify({
      source: 'openawork_internal',
      type: 'assistant_event',
      text: '卡片',
    });
    const normalized = buildNormalizedConversationFromHistory([
      syntheticMessage('synthetic-ui-shaped', uiEventShaped),
    ]);

    expect(normalized).toEqual([{ role: 'user', content: uiEventShaped }]);
  });
});
