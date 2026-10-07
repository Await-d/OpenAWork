import { describe, expect, it } from 'vitest';
import type {
  ChatRenderEntry,
  ChatRenderGroup,
} from '../../chat/message/chat-message-group-list.js';
import {
  appendRenderEntryToMessageGroups,
  groupChatRenderEntries,
  reconcileChatRenderGroups,
} from './group-render-entries.js';

/**
 * 取回消息组：协议已改为判别联合（`kind`），访问 `.entries` 前必须窄化。
 * 若实际不是消息组则**直接让测试失败**（而不是静默跳过断言）。
 */
function requireMessageGroup(
  group: ChatRenderGroup | undefined,
): ChatRenderGroup & { kind: 'messages' } {
  if (group?.kind !== 'messages') {
    throw new Error(`期望消息组，实际为 ${String(group?.kind)}`);
  }
  return group;
}

function assistantEntry(id: string, groupIdentityKey?: string): ChatRenderEntry {
  return {
    message: {
      id,
      role: 'assistant',
      content: `message:${id}`,
      ...(groupIdentityKey ? { agentId: groupIdentityKey } : {}),
    },
    ...(groupIdentityKey ? { groupIdentityKey } : {}),
    renderContent: () => null,
  };
}

function assistantRequestEntry(id: string, clientRequestId: string): ChatRenderEntry {
  return {
    ...assistantEntry(id),
    message: {
      ...assistantEntry(id).message,
      clientRequestId,
    },
  };
}

function userEntry(id: string): ChatRenderEntry {
  return {
    message: {
      id,
      role: 'user',
      content: `message:${id}`,
    },
    renderContent: () => null,
  };
}

/** 按调用方约定拼接「复用前缀 + 重算尾部」，返回最终展示组序列。 */
function applyReconcileResult(
  previousGroups: ChatRenderGroup[],
  result: ReturnType<typeof reconcileChatRenderGroups>,
): ChatRenderGroup[] {
  return [...previousGroups.slice(0, result.reusedGroupCount), ...result.tailGroups];
}

function entryIds(group: ChatRenderGroup | undefined): string[] {
  return requireMessageGroup(group).entries.map((entry) => entry.message.id);
}

describe('groupChatRenderEntries', () => {
  it('相邻 assistant 且来源身份相同时合并到同一组', () => {
    const groups = groupChatRenderEntries([
      assistantEntry('a1', 'interaction-agent'),
      assistantEntry('a2', 'interaction-agent'),
    ]);

    expect(groups).toHaveLength(1);
    expect(requireMessageGroup(groups[0]).entries).toHaveLength(2);
  });

  it('相邻 assistant 但来源身份不同，不再误并组', () => {
    const groups = groupChatRenderEntries([
      assistantEntry('a1', 'interaction-agent'),
      assistantEntry('a2', 'prometheus'),
      assistantEntry('a3', 'prometheus'),
    ]);

    expect(groups).toHaveLength(2);
    expect(requireMessageGroup(groups[0]).entries).toHaveLength(1);
    expect(requireMessageGroup(groups[1]).entries).toHaveLength(2);
  });

  it('同一请求的不同 assistant 轮次不在分组层被吞掉', () => {
    const groups = groupChatRenderEntries([
      assistantRequestEntry('server-copy', 'request-1'),
      assistantRequestEntry('stream-copy', 'request-1'),
    ]);

    expect(groups).toHaveLength(1);
    expect(requireMessageGroup(groups[0]).entries).toHaveLength(2);
  });

  it('工具轮派生请求与最终请求仍分别展示', () => {
    const groups = groupChatRenderEntries([
      assistantRequestEntry('tool-round', 'request-1:assistant:1'),
      assistantRequestEntry('final-round', 'request-1'),
    ]);

    expect(requireMessageGroup(groups[0]).entries).toHaveLength(2);
  });
});

describe('reconcileChatRenderGroups', () => {
  it('entry 序列完全一致时整段复用，不重建任何组', () => {
    const entries = [userEntry('u1'), assistantEntry('a2', 'pm1'), assistantEntry('a3', 'pm1')];
    const groups = groupChatRenderEntries(entries);

    const result = reconcileChatRenderGroups({
      previousEntries: entries,
      previousGroups: groups,
      nextEntries: [...entries],
    });

    expect(result.reusedGroupCount).toBe(2);
    expect(result.tailGroups).toEqual([]);
    const display = applyReconcileResult(groups, result);
    expect(display[0]).toBe(groups[0]);
    expect(display[1]).toBe(groups[1]);
  });

  it('仅尾部 entry 被替换（流式帧）时，前缀组引用保持稳定', () => {
    const u1 = userEntry('u1');
    const a2 = assistantEntry('a2', 'pm1');
    const a3 = assistantEntry('a3', 'pm1');
    const previousEntries = [u1, a2, a3];
    const previousGroups = groupChatRenderEntries(previousEntries);
    const a3Next = assistantEntry('a3', 'pm1');

    const display = applyReconcileResult(
      previousGroups,
      reconcileChatRenderGroups({
        previousEntries,
        previousGroups,
        nextEntries: [u1, a2, a3Next],
      }),
    );

    expect(display).toHaveLength(2);
    expect(display[0]).toBe(previousGroups[0]);
    expect(display[1]).not.toBe(previousGroups[1]);
    expect(entryIds(display[1])).toEqual(['a2', 'a3']);
    expect(requireMessageGroup(display[1]).entries[1]?.message).toBe(a3Next.message);
  });

  it('尾部追加且相邻条件满足时，只重建吸收新 entry 的最后一组', () => {
    const u1 = userEntry('u1');
    const a2 = assistantEntry('a2', 'pm1');
    const a3 = assistantEntry('a3', 'pm1');
    const previousEntries = [u1, a2, a3];
    const previousGroups = groupChatRenderEntries(previousEntries);
    const a4 = assistantEntry('a4', 'pm1');

    const display = applyReconcileResult(
      previousGroups,
      reconcileChatRenderGroups({
        previousEntries,
        previousGroups,
        nextEntries: [u1, a2, a3, a4],
      }),
    );

    expect(display).toHaveLength(2);
    expect(display[0]).toBe(previousGroups[0]);
    expect(entryIds(display[1])).toEqual(['a2', 'a3', 'a4']);
  });

  it('尾部追加身份不同的 entry 时新起一组，前缀组引用保持稳定', () => {
    const u1 = userEntry('u1');
    const a2 = assistantEntry('a2', 'pm1');
    const a3 = assistantEntry('a3', 'pm1');
    const previousEntries = [u1, a2, a3];
    const previousGroups = groupChatRenderEntries(previousEntries);
    const a4 = assistantEntry('a4', 'executor');

    const display = applyReconcileResult(
      previousGroups,
      reconcileChatRenderGroups({
        previousEntries,
        previousGroups,
        nextEntries: [u1, a2, a3, a4],
      }),
    );

    expect(display).toHaveLength(3);
    expect(display[0]).toBe(previousGroups[0]);
    expect(entryIds(display[2])).toEqual(['a4']);
  });

  it('中间 entry 变化时只重算其所在组及之后的组', () => {
    const u1 = userEntry('u1');
    const a2 = assistantEntry('a2', 'pm1');
    const u3 = userEntry('u3');
    const a4 = assistantEntry('a4', 'executor');
    const previousEntries = [u1, a2, u3, a4];
    const previousGroups = groupChatRenderEntries(previousEntries);
    const u3Next = userEntry('u3');

    const display = applyReconcileResult(
      previousGroups,
      reconcileChatRenderGroups({
        previousEntries,
        previousGroups,
        nextEntries: [u1, a2, u3Next, a4],
      }),
    );

    expect(display).toHaveLength(4);
    expect(display[0]).toBe(previousGroups[0]);
    expect(display[1]).toBe(previousGroups[1]);
    expect(display[2]).not.toBe(previousGroups[2]);
    expect(entryIds(display[2])).toEqual(['u3']);
    expect(entryIds(display[3])).toEqual(['a4']);
  });

  it('重算尾部沿用前缀已消费的 message id 去重（与全量分组等价）', () => {
    const u1 = userEntry('u1');
    const a2 = assistantEntry('a2', 'pm1');
    const previousEntries = [u1, a2];
    const previousGroups = groupChatRenderEntries(previousEntries);
    const a2Next = assistantEntry('a2', 'pm1');
    const u1Duplicate = userEntry('u1');

    const display = applyReconcileResult(
      previousGroups,
      reconcileChatRenderGroups({
        previousEntries,
        previousGroups,
        nextEntries: [u1, a2Next, u1Duplicate],
      }),
    );

    expect(display).toHaveLength(2);
    expect(entryIds(display[0])).toEqual(['u1']);
    expect(entryIds(display[1])).toEqual(['a2']);
    // 与全量分组逐组等价。
    expect(entryIds(display[1])).toEqual(
      entryIds(groupChatRenderEntries([u1, a2Next, u1Duplicate])[1]),
    );
  });

  it('身份变化使尾部组可与复用前缀最后一组合并时，合并组进入重算尾部', () => {
    const a1 = assistantEntry('a1');
    const a2 = assistantEntry('a2', 'pm1');
    const previousEntries = [a1, a2];
    const previousGroups = groupChatRenderEntries(previousEntries);
    expect(previousGroups).toHaveLength(2);
    const a2Next = assistantEntry('a2');

    const result = reconcileChatRenderGroups({
      previousEntries,
      previousGroups,
      nextEntries: [a1, a2Next],
    });
    const display = applyReconcileResult(previousGroups, result);

    expect(result.reusedGroupCount).toBe(0);
    expect(display).toHaveLength(1);
    expect(entryIds(display[0])).toEqual(['a1', 'a2']);
    expect(requireMessageGroup(display[0]).entries[1]?.message).toBe(a2Next.message);
  });
});

describe('appendRenderEntryToMessageGroups', () => {
  it('相邻条件满足时只重建最后一组，历史组引用保持稳定', () => {
    const groups = groupChatRenderEntries([userEntry('u1'), assistantEntry('a2')]);
    const a3 = assistantEntry('a3');

    const next = appendRenderEntryToMessageGroups(groups, a3);

    expect(next).toHaveLength(2);
    expect(next[0]).toBe(groups[0]);
    expect(next[1]).not.toBe(groups[1]);
    expect(entryIds(next[1])).toEqual(['a2', 'a3']);
  });

  it('相邻条件不满足时追加新组，全部既有组引用保持稳定', () => {
    const groups = groupChatRenderEntries([userEntry('u1'), assistantEntry('a2')]);
    const u3 = userEntry('u3');

    const next = appendRenderEntryToMessageGroups(groups, u3);

    expect(next).toHaveLength(3);
    expect(next[0]).toBe(groups[0]);
    expect(next[1]).toBe(groups[1]);
    expect(entryIds(next[2])).toEqual(['u3']);
  });
});
