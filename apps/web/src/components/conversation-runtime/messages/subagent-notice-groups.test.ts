import { describe, expect, it } from 'vitest';
import type { SubagentNotice } from '@openAwork/shared';
import type { ChatRenderGroup } from '../../chat/message/chat-message-group-list.js';
import {
  buildSubagentNoticeGroups,
  mergeNoticeGroupsIntoRenderGroups,
} from './subagent-notice-groups.js';

function notice(id: string, createdAt: number): SubagentNotice {
  return {
    id,
    agent: 'explore',
    state: 'done',
    description: `任务 ${id}`,
    text: `通知 ${id}`,
    createdAt,
  };
}

function messageGroup(id: string, createdAt: number): ChatRenderGroup {
  return {
    kind: 'messages',
    key: id,
    role: 'assistant',
    entries: [
      {
        message: { id, role: 'assistant', content: '内容', createdAt } as never,
        renderContent: () => null,
      },
    ],
  };
}

describe('buildSubagentNoticeGroups', () => {
  it('构建带时间戳的 notice 群组并使用稳定 key', () => {
    const groups = buildSubagentNoticeGroups([notice('n-1', 100)]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      kind: 'subagent-notice',
      key: 'subagent-notice:n-1',
      createdAt: 100,
    });
  });

  it('空输入返回空数组', () => {
    expect(buildSubagentNoticeGroups([])).toEqual([]);
  });
});

describe('mergeNoticeGroupsIntoRenderGroups', () => {
  it('无通知时原样返回消息群组（引用不变，避免无谓重渲染）', () => {
    const messageGroups = [messageGroup('m-1', 100)];
    expect(mergeNoticeGroupsIntoRenderGroups({ messageGroups, noticeGroups: [] })).toBe(
      messageGroups,
    );
  });

  it('按时间位置把通知插入消息之间', () => {
    const merged = mergeNoticeGroupsIntoRenderGroups({
      messageGroups: [messageGroup('m-1', 100), messageGroup('m-2', 300)],
      noticeGroups: buildSubagentNoticeGroups([notice('n-1', 200)]),
    });

    expect(merged.map((group) => group.key)).toEqual(['m-1', 'subagent-notice:n-1', 'm-2']);
  });

  it('早于全部消息的通知排在最前；晚于全部消息的排在最后', () => {
    const merged = mergeNoticeGroupsIntoRenderGroups({
      messageGroups: [messageGroup('m-1', 200)],
      noticeGroups: buildSubagentNoticeGroups([notice('n-late', 500), notice('n-early', 100)]),
    });

    expect(merged.map((group) => group.key)).toEqual([
      'subagent-notice:n-early',
      'm-1',
      'subagent-notice:n-late',
    ]);
  });

  it('同一时间戳时通知排在消息之后（通知是消息执行的结果）', () => {
    const merged = mergeNoticeGroupsIntoRenderGroups({
      messageGroups: [messageGroup('m-1', 200)],
      noticeGroups: buildSubagentNoticeGroups([notice('n-same', 200)]),
    });

    expect(merged.map((group) => group.key)).toEqual(['m-1', 'subagent-notice:n-same']);
  });

  it('多条通知按时间升序稳定排列', () => {
    const merged = mergeNoticeGroupsIntoRenderGroups({
      messageGroups: [messageGroup('m-1', 1000)],
      noticeGroups: buildSubagentNoticeGroups([
        notice('n-c', 300),
        notice('n-a', 100),
        notice('n-b', 200),
      ]),
    });

    expect(merged.map((group) => group.key)).toEqual([
      'subagent-notice:n-a',
      'subagent-notice:n-b',
      'subagent-notice:n-c',
      'm-1',
    ]);
  });

  it('时间戳不可知的消息组不阻塞通知插入', () => {
    const brokenGroup: ChatRenderGroup = {
      kind: 'messages',
      key: 'm-broken',
      role: 'assistant',
      entries: [
        {
          message: { id: 'm-broken', role: 'assistant', content: '', createdAt: 'junk' } as never,
          renderContent: () => null,
        },
      ],
    };

    const merged = mergeNoticeGroupsIntoRenderGroups({
      messageGroups: [brokenGroup, messageGroup('m-2', 500)],
      noticeGroups: buildSubagentNoticeGroups([notice('n-1', 100)]),
    });

    expect(merged.map((group) => group.key)).toEqual(['m-broken', 'subagent-notice:n-1', 'm-2']);
  });
});
