import { describe, expect, it } from 'vitest';
import type { SubagentNotice } from '@openAwork/shared';
import type {
  ChatRenderAction,
  ChatRenderEntry,
  ChatRenderGroup,
} from '../../chat/message/chat-message-group-list.js';
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

function entry(id: string, createdAt: number): ChatRenderEntry {
  return {
    message: { id, role: 'assistant', content: '内容', createdAt } as never,
    renderContent: () => null,
  };
}

function messageGroup(id: string, createdAt: number): ChatRenderGroup {
  return {
    kind: 'messages',
    key: id,
    role: 'assistant',
    entries: [entry(id, createdAt)],
  };
}

/** 多条目消息组（模拟同一次请求的多轮 assistant 输出被聚合成一个视觉组）。 */
function multiEntryGroup(
  id: string,
  entryTimestamps: number[],
  actions?: ChatRenderAction[],
): ChatRenderGroup {
  return {
    kind: 'messages',
    key: id,
    role: 'assistant',
    entries: entryTimestamps.map((timestamp, index) => entry(`${id}-${index}`, timestamp)),
    ...(actions ? { actions } : {}),
  };
}

/** 把群组序列压缩成「组内条目 / 通知」的可读序列，便于断言拆组位置。 */
function flatten(groups: ChatRenderGroup[]): string[] {
  return groups.flatMap((group) =>
    group.kind === 'subagent-notice'
      ? [`notice:${group.notice.id}`]
      : group.entries.map((groupEntry) => `msg:${groupEntry.message.id}`),
  );
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

  it('通知时间戳落在群组条目跨度内时，按条目边界拆组并插在中间', () => {
    // 同一次请求的两轮 assistant 输出（A1 派发子代理、A2 使用其结果）本会合成一组；
    // 通知在 A1 与 A2 之间落库，必须渲染在 A2 之前，而不是整组之后。
    const merged = mergeNoticeGroupsIntoRenderGroups({
      messageGroups: [messageGroup('u-1', 1000), multiEntryGroup('a-turn', [2000, 9000])],
      noticeGroups: buildSubagentNoticeGroups([notice('n-1', 5000)]),
    });

    expect(flatten(merged)).toEqual(['msg:u-1', 'msg:a-turn-0', 'notice:n-1', 'msg:a-turn-1']);
    expect(merged.map((group) => group.key)).toEqual([
      'u-1',
      'a-turn',
      'subagent-notice:n-1',
      'a-turn-1',
    ]);
  });

  it('多条通知落在同一群组内时逐段拆开，保持时间升序', () => {
    const merged = mergeNoticeGroupsIntoRenderGroups({
      messageGroups: [multiEntryGroup('a-turn', [1000, 2000, 9000])],
      noticeGroups: buildSubagentNoticeGroups([notice('n-1', 1500), notice('n-2', 5000)]),
    });

    expect(flatten(merged)).toEqual([
      'msg:a-turn-0',
      'notice:n-1',
      'msg:a-turn-1',
      'notice:n-2',
      'msg:a-turn-2',
    ]);
  });

  it('同一边界前的多条通知按时间升序连续排列', () => {
    const merged = mergeNoticeGroupsIntoRenderGroups({
      messageGroups: [multiEntryGroup('a-turn', [1000, 2000])],
      noticeGroups: buildSubagentNoticeGroups([notice('n-1', 1500), notice('n-2', 1800)]),
    });

    expect(flatten(merged)).toEqual(['msg:a-turn-0', 'notice:n-1', 'notice:n-2', 'msg:a-turn-1']);
  });

  it('通知晚于组内最后条目时保持在整组之后（不拆组）', () => {
    const merged = mergeNoticeGroupsIntoRenderGroups({
      messageGroups: [multiEntryGroup('a-turn', [1000, 2000])],
      noticeGroups: buildSubagentNoticeGroups([notice('n-late', 3000)]),
    });

    expect(flatten(merged)).toEqual(['msg:a-turn-0', 'msg:a-turn-1', 'notice:n-late']);
  });

  it('组内同时间戳时通知排在该条目之后', () => {
    const merged = mergeNoticeGroupsIntoRenderGroups({
      messageGroups: [multiEntryGroup('a-turn', [1000, 5000, 9000])],
      noticeGroups: buildSubagentNoticeGroups([notice('n-same', 5000)]),
    });

    expect(flatten(merged)).toEqual([
      'msg:a-turn-0',
      'msg:a-turn-1',
      'notice:n-same',
      'msg:a-turn-2',
    ]);
  });

  it('拆组后首段保留组级 actions 与稳定 key，后续段以首条目 id 作 key', () => {
    const merged = mergeNoticeGroupsIntoRenderGroups({
      messageGroups: [
        multiEntryGroup(
          'a-turn',
          [2000, 9000],
          [{ id: 'copy', label: '复制', onClick: () => undefined }],
        ),
      ],
      noticeGroups: buildSubagentNoticeGroups([notice('n-1', 5000)]),
    });

    const [first, second, third] = merged;
    expect(first).toMatchObject({ kind: 'messages', key: 'a-turn' });
    expect(first?.kind === 'messages' ? first.actions : undefined).toEqual([
      expect.objectContaining({ id: 'copy' }),
    ]);
    expect(second).toMatchObject({ kind: 'subagent-notice', key: 'subagent-notice:n-1' });
    expect(third).toMatchObject({ kind: 'messages', key: 'a-turn-1' });
    expect(third?.kind === 'messages' ? third.actions : undefined).toBeUndefined();
  });

  it('未被通知拆开的群组保持原引用（避免无谓重渲染）', () => {
    const group = multiEntryGroup('a-turn', [1000, 2000]);
    const merged = mergeNoticeGroupsIntoRenderGroups({
      messageGroups: [group],
      noticeGroups: buildSubagentNoticeGroups([notice('n-1', 3000)]),
    });

    expect(merged[0]).toBe(group);
  });
});
