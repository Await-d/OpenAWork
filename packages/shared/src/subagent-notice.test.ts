import { describe, expect, it } from 'vitest';
import type { Message } from '@openAwork/shared';
import { parseSubagentNotice } from './subagent-notice.js';

function buildMessage(overrides: Partial<Message>): Message {
  return {
    id: 'msg-1',
    role: 'synthetic',
    content: [{ type: 'text', text: '子代理已完成 · 审计会话唤醒原语' }],
    createdAt: 1,
    description: '审计会话唤醒原语',
    metadata: {
      source: 'subagent',
      childID: 'child-1',
      agent: 'explore',
      state: 'done',
    },
    ...overrides,
  };
}

describe('parseSubagentNotice', () => {
  it('解析出完整的通知契约', () => {
    const notice = parseSubagentNotice(buildMessage({}));

    expect(notice).toMatchObject({
      id: 'msg-1',
      agent: 'explore',
      state: 'done',
      description: '审计会话唤醒原语',
      childSessionId: 'child-1',
    });
    expect(notice?.text).toBe('子代理已完成 · 审计会话唤醒原语');
  });

  it('非 synthetic 角色一律返回 null', () => {
    for (const role of ['user', 'assistant', 'tool', 'system'] as const) {
      expect(parseSubagentNotice(buildMessage({ role }))).toBeNull();
    }
  });

  it('synthetic 但 metadata.source 不是 subagent 时返回 null', () => {
    expect(
      parseSubagentNotice(buildMessage({ metadata: { source: 'shell', state: 'done' } })),
    ).toBeNull();
    expect(parseSubagentNotice(buildMessage({ metadata: undefined }))).toBeNull();
    expect(parseSubagentNotice(buildMessage({ metadata: { childID: 'x' } }))).toBeNull();
  });

  it('state 缺失时回落 done，未知 state 也回落 done', () => {
    expect(
      parseSubagentNotice(buildMessage({ metadata: { source: 'subagent', childID: 'c' } }))?.state,
    ).toBe('done');
    expect(
      parseSubagentNotice(
        buildMessage({ metadata: { source: 'subagent', state: 'weird', childID: 'c' } }),
      )?.state,
    ).toBe('done');
  });

  it('failed / cancelled 正确映射', () => {
    expect(
      parseSubagentNotice(buildMessage({ metadata: { source: 'subagent', state: 'failed' } }))
        ?.state,
    ).toBe('failed');
    expect(
      parseSubagentNotice(buildMessage({ metadata: { source: 'subagent', state: 'cancelled' } }))
        ?.state,
    ).toBe('cancelled');
  });

  it('description 为空且非 failed 时不成形（对齐上游 isNotice）', () => {
    expect(parseSubagentNotice(buildMessage({ description: '' }))).toBeNull();
    expect(parseSubagentNotice(buildMessage({ description: '   ' }))).toBeNull();
  });

  it('failed 即使 description 为空也强制可见（对齐上游 timelineNoticeRequired）', () => {
    const notice = parseSubagentNotice(
      buildMessage({
        description: '',
        metadata: { source: 'subagent', state: 'failed', childID: 'child-9' },
      }),
    );

    expect(notice).not.toBeNull();
    expect(notice?.state).toBe('failed');
    expect(notice?.description).toBe('');
    expect(notice?.childSessionId).toBe('child-9');
  });

  it('agent 与 childID 缺失时回退为中性占位且不可跳转', () => {
    const notice = parseSubagentNotice(
      buildMessage({ metadata: { source: 'subagent', state: 'done' } }),
    );

    expect(notice?.agent).toBe('子代理');
    expect(notice?.childSessionId).toBeUndefined();
  });

  it('拼接多个 text part 作为正文，并忽略非 text part', () => {
    const notice = parseSubagentNotice(
      buildMessage({
        content: [
          { type: 'text', text: '第一段' },
          { type: 'input_image', artifactId: 'a-1' },
          { type: 'text', text: '第二段' },
        ],
      }),
    );

    expect(notice?.text).toBe('第一段\n第二段');
  });

  it('剥离 <subagent> 包裹，客户端拿到纯正文', () => {
    const notice = parseSubagentNotice(
      buildMessage({
        content: [
          {
            type: 'text',
            text: [
              '<subagent sessionID="child-1" state="done" description="审计会话唤醒原语">',
              '子代理已完成 · 审计会话唤醒原语',
              '</subagent>',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(notice?.text).toBe('子代理已完成 · 审计会话唤醒原语');
  });

  it('无包裹时正文保持原样（兼容存量消息）', () => {
    const notice = parseSubagentNotice(buildMessage({}));
    expect(notice?.text).toBe('子代理已完成 · 审计会话唤醒原语');
  });
});
