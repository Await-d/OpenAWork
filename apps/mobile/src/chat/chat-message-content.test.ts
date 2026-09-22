import { describe, expect, it } from 'vitest';
import {
  collectMobileSubagentNotices,
  mergeMobileSubagentNotices,
  normalizeMobileChatMessages,
  parseMobileSubagentNotice,
} from './chat-message-content.js';
import type { MobileSubagentNotice } from './chat-message-content.js';

describe('normalizeMobileChatMessages', () => {
  it('按首次出现顺序去除重复消息 id，避免 FlatList key 冲突', () => {
    const messages = normalizeMobileChatMessages([
      { id: 'same-id', role: 'user', content: '第一次' },
      { id: 'same-id', role: 'user', content: '重复项' },
      { id: 'next-id', role: 'assistant', content: '下一条' },
    ]);

    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.id)).toEqual(['same-id', 'next-id']);
    expect(messages[0]?.content).toBe('第一次');
  });

  it('synthetic（网关注入的子代理通知）不得进入移动端 transcript', () => {
    const messages = normalizeMobileChatMessages([
      {
        id: 's-1',
        role: 'synthetic',
        content: '子代理已完成 · 审计会话唤醒原语',
        description: '审计会话唤醒原语',
        metadata: { source: 'subagent', childID: 'child-1', agent: 'explore', state: 'completed' },
      },
      { id: 'u-1', role: 'user', content: '保留我' },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.id).toBe('u-1');
  });
});

function buildRawNotice(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'n-1',
    role: 'synthetic',
    content: [{ type: 'text', text: '子代理已完成任务' }],
    description: '审计会话唤醒原语',
    metadata: { source: 'subagent', childID: 'child-1', agent: 'explore', state: 'done' },
    ...overrides,
  };
}

describe('parseMobileSubagentNotice', () => {
  it('done / failed / cancelled 三态均成形且保留状态', () => {
    for (const state of ['done', 'failed', 'cancelled'] as const) {
      const notice = parseMobileSubagentNotice(
        buildRawNotice({ metadata: { source: 'subagent', agent: 'explore', state } }),
      );

      expect(notice?.state).toBe(state);
      expect(notice?.agent).toBe('explore');
      expect(notice?.description).toBe('审计会话唤醒原语');
    }
  });

  it('非 synthetic 行返回 null', () => {
    expect(parseMobileSubagentNotice(buildRawNotice({ role: 'assistant' }))).toBeNull();
    expect(parseMobileSubagentNotice(buildRawNotice({ role: 'user' }))).toBeNull();
  });

  it('metadata.source 非 subagent（含缺失）返回 null', () => {
    expect(parseMobileSubagentNotice(buildRawNotice({ metadata: { source: 'other' } }))).toBeNull();
    expect(parseMobileSubagentNotice(buildRawNotice({ metadata: { childID: 'c' } }))).toBeNull();
    expect(parseMobileSubagentNotice(buildRawNotice({ metadata: undefined }))).toBeNull();
  });

  it('failed 即使 description 为空也强制可见', () => {
    const notice = parseMobileSubagentNotice(
      buildRawNotice({
        description: '',
        metadata: { source: 'subagent', state: 'failed', childID: 'child-9' },
      }),
    );

    expect(notice).not.toBeNull();
    expect(notice?.state).toBe('failed');
    expect(notice?.description).toBe('');
    expect(notice?.childSessionId).toBe('child-9');
  });

  it('done / cancelled 空 description 不可见', () => {
    expect(
      parseMobileSubagentNotice(
        buildRawNotice({ description: '   ', metadata: { source: 'subagent', state: 'done' } }),
      ),
    ).toBeNull();
    expect(
      parseMobileSubagentNotice(
        buildRawNotice({ description: '', metadata: { source: 'subagent', state: 'cancelled' } }),
      ),
    ).toBeNull();
  });

  it('state 缺失或非法时回落 done', () => {
    const missing = parseMobileSubagentNotice(buildRawNotice({ metadata: { source: 'subagent' } }));
    const invalid = parseMobileSubagentNotice(
      buildRawNotice({ metadata: { source: 'subagent', state: 'completed' } }),
    );

    expect(missing?.state).toBe('done');
    expect(invalid?.state).toBe('done');
  });

  it('agent 缺失回落中性占位，childID 缺失则不可跳转', () => {
    const notice = parseMobileSubagentNotice(buildRawNotice({ metadata: { source: 'subagent' } }));

    expect(notice?.agent).toBe('子代理');
    expect(notice?.childSessionId).toBeUndefined();
  });

  it('description 两端空白被裁剪', () => {
    const notice = parseMobileSubagentNotice(
      buildRawNotice({ description: '  审计会话唤醒原语  ' }),
    );

    expect(notice?.description).toBe('审计会话唤醒原语');
  });

  it('正文拼接所有 text part 并忽略其它 part', () => {
    const notice = parseMobileSubagentNotice(
      buildRawNotice({
        content: [
          { type: 'text', text: '第一段' },
          { type: 'reasoning', text: '不应出现' },
          { type: 'text', text: '第二段' },
          { type: 'tool_call', toolName: 'bash' },
        ],
      }),
    );

    expect(notice?.text).toBe('第一段\n第二段');
  });

  it('缺少可用 id 时返回 null（无法作为列表 key）', () => {
    expect(parseMobileSubagentNotice(buildRawNotice({ id: '' }))).toBeNull();
    expect(parseMobileSubagentNotice(buildRawNotice({ id: 42 }))).toBeNull();
  });

  it('非对象输入返回 null', () => {
    expect(parseMobileSubagentNotice(null)).toBeNull();
    expect(parseMobileSubagentNotice('not-a-row')).toBeNull();
    expect(parseMobileSubagentNotice([])).toBeNull();
  });
});

describe('collectMobileSubagentNotices', () => {
  it('按出现顺序收集通知并忽略非通知行', () => {
    const notices = collectMobileSubagentNotices([
      { id: 'u-1', role: 'user', content: '你好' },
      buildRawNotice({ id: 'n-1' }),
      buildRawNotice({
        id: 'n-2',
        description: '',
        metadata: { source: 'subagent', state: 'failed' },
      }),
      buildRawNotice({ id: 'n-3', metadata: { source: 'other' } }),
      buildRawNotice({
        id: 'n-4',
        description: '',
        metadata: { source: 'subagent', state: 'done' },
      }),
    ]);

    expect(notices.map((notice) => notice.id)).toEqual(['n-1', 'n-2']);
    expect(notices[1]?.state).toBe('failed');
  });

  it('非数组输入返回空数组', () => {
    expect(collectMobileSubagentNotices(undefined)).toEqual([]);
    expect(collectMobileSubagentNotices({ messages: [] })).toEqual([]);
  });
});

function buildNotice(
  id: string,
  overrides: Partial<MobileSubagentNotice> = {},
): MobileSubagentNotice {
  return {
    id,
    agent: 'explore',
    state: 'done',
    description: `任务 ${id}`,
    text: `正文 ${id}`,
    createdAt: 0,
    ...overrides,
  };
}

describe('mergeMobileSubagentNotices', () => {
  it('新通知按 incoming 顺序追加在已展示通知之后', () => {
    const existing = [buildNotice('n-1')];

    const merged = mergeMobileSubagentNotices(existing, [
      buildNotice('n-1'),
      buildNotice('n-2'),
      buildNotice('n-3'),
    ]);

    expect(merged.map((notice) => notice.id)).toEqual(['n-1', 'n-2', 'n-3']);
  });

  it('重复通知不重复，同 id 以最新一份为准', () => {
    const merged = mergeMobileSubagentNotices(
      [buildNotice('n-1', { state: 'done', text: '旧正文' })],
      [
        buildNotice('n-1', { state: 'failed', text: '新正文' }),
        buildNotice('n-1', { state: 'failed', text: '新正文' }),
      ],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.state).toBe('failed');
    expect(merged[0]?.text).toBe('新正文');
  });

  it('重复合并同一快照是幂等的（保持首次出现的顺序）', () => {
    const snapshot = [buildNotice('n-2'), buildNotice('n-1')];

    const once = mergeMobileSubagentNotices([], snapshot);
    const twice = mergeMobileSubagentNotices(once, snapshot);

    expect(twice.map((notice) => notice.id)).toEqual(['n-2', 'n-1']);
  });

  it('缺失字段与脏数据被容忍：nullish 输入返回空、无 id 项跳过', () => {
    expect(mergeMobileSubagentNotices(undefined, undefined)).toEqual([]);
    expect(mergeMobileSubagentNotices(null, [])).toEqual([]);
    expect(mergeMobileSubagentNotices([undefined, null], [undefined])).toEqual([]);

    const merged = mergeMobileSubagentNotices(
      [{ id: '' } as MobileSubagentNotice, buildNotice('n-9')],
      [{ id: 42 } as unknown as MobileSubagentNotice],
    );

    expect(merged.map((notice) => notice.id)).toEqual(['n-9']);
  });
});
