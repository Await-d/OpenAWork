import { describe, expect, it } from 'vitest';
import { collectSubagentNotices } from './subagent-notices.js';

function syntheticRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'msg-1',
    role: 'synthetic',
    content: [{ type: 'text', text: '子代理已完成 · 审计会话唤醒原语' }],
    createdAt: 1,
    description: '审计会话唤醒原语',
    metadata: { source: 'subagent', childID: 'child-1', agent: 'explore', state: 'done' },
    ...overrides,
  };
}

describe('collectSubagentNotices', () => {
  it('从原始行收集通知并保留顺序', () => {
    const notices = collectSubagentNotices([
      { id: 'u-1', role: 'user', content: '你好', createdAt: 0 },
      syntheticRow({ id: 's-1' }),
      { id: 'a-1', role: 'assistant', content: '收到', createdAt: 2 },
      syntheticRow({
        id: 's-2',
        description: '修复登录',
        metadata: { source: 'subagent', childID: 'child-2', agent: 'general', state: 'failed' },
      }),
    ]);

    expect(notices.map((notice) => notice.id)).toEqual(['s-1', 's-2']);
    expect(notices[0]).toMatchObject({
      agent: 'explore',
      state: 'done',
      description: '审计会话唤醒原语',
      childSessionId: 'child-1',
    });
    expect(notices[1]).toMatchObject({ state: 'failed', agent: 'general' });
  });

  it('忽略非 synthetic、非 subagent 来源与畸形行', () => {
    const notices = collectSubagentNotices([
      null,
      undefined,
      'junk',
      42,
      { id: 'a-1', role: 'assistant', content: '内容', createdAt: 1 },
      syntheticRow({ id: 's-other', metadata: { source: 'shell', state: 'done' } }),
      syntheticRow({ id: 's-empty-meta', metadata: undefined }),
      { role: 'synthetic', content: [], createdAt: 1, metadata: { source: 'subagent' } },
    ]);

    expect(notices).toHaveLength(0);
  });

  it('failed 且描述为空时仍强制可见（对齐上游可见性规则）', () => {
    const notices = collectSubagentNotices([
      syntheticRow({
        id: 's-failed',
        description: '',
        metadata: { source: 'subagent', childID: 'child-9', agent: 'explore', state: 'failed' },
      }),
      syntheticRow({ id: 's-done-empty', description: '' }),
    ]);

    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ id: 's-failed', state: 'failed', description: '' });
  });

  it('非数组输入返回空数组', () => {
    expect(collectSubagentNotices(undefined)).toEqual([]);
    expect(collectSubagentNotices(null)).toEqual([]);
    expect(collectSubagentNotices('junk')).toEqual([]);
  });

  it('description 与 metadata 缺失时不误判为通知', () => {
    const notices = collectSubagentNotices([
      {
        id: 's-1',
        role: 'synthetic',
        content: [{ type: 'text', text: '无来源标记' }],
        createdAt: 1,
      },
    ]);

    expect(notices).toHaveLength(0);
  });
});
