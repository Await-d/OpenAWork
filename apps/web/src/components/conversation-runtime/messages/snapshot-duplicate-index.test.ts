import { describe, expect, it } from 'vitest';
import type { ChatMessage } from './message-model.js';
import {
  areLogicalMessageDuplicates,
  areStronglyIdenticalMessages,
} from './message-equivalence.js';
import { SnapshotDuplicateIndex } from './snapshot-duplicate-index.js';

function message(id: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role: 'assistant', content: '相同正文', createdAt: 1000, ...overrides };
}

describe('SnapshotDuplicateIndex', () => {
  it('快照中同文但身份独立的消息不折叠，本地副本仍可模糊匹配', () => {
    const output = [message('server')];
    const index = new SnapshotDuplicateIndex(new Set(['server', 'another-server']));
    index.register(0, output[0]!);

    expect(index.find(message('another-server'), output)).toBe(-1);
    expect(index.find(message('local'), output)).toBe(0);
  });

  it('候选来自不同身份索引时仍返回最早位置', () => {
    const output = [
      message('first', { parts: [{ id: 'shared', type: 'text', text: '正文' }] }),
      message('second', { clientRequestId: 'req' }),
    ];
    const index = new SnapshotDuplicateIndex(new Set(['first', 'second', 'next']));
    output.forEach((entry, position) => index.register(position, entry));

    expect(
      index.find(
        message('next', {
          clientRequestId: 'req',
          parts: [{ id: 'shared', type: 'text', text: '正文' }],
        }),
        output,
      ),
    ).toBe(0);
  });

  it('替换后撤销旧身份并注册新身份和快照归属', () => {
    const previous = message('local', {
      clientRequestId: 'old-request',
      parts: [{ id: 'old-part', type: 'text', text: '正文' }],
    });
    const replacement = message('server', { clientRequestId: 'new-request' });
    const output = [replacement];
    const index = new SnapshotDuplicateIndex(new Set(['server', 'probe']));
    index.register(0, previous);
    index.replace(0, previous, replacement);

    expect(index.find(message('probe', { clientRequestId: 'old-request' }), output)).toBe(-1);
    expect(index.find(message('probe', { clientRequestId: 'new-request' }), output)).toBe(0);
    expect(index.find(message('probe'), output)).toBe(-1);
  });

  it('与原顺序扫描规则在混合身份、角色和快照归属下保持一致', () => {
    const messages: ChatMessage[] = Array.from({ length: 80 }, (_, position) =>
      message(`m-${position % 21}`, {
        role: position % 3 === 0 ? 'user' : 'assistant',
        content: `正文-${position % 7}`,
        createdAt: 1000 + position * 1000,
        ...(position % 4 === 0 ? {} : { clientRequestId: `req-${position % 9}` }),
        ...(position % 5 === 0
          ? { parts: [{ id: `part-${position % 13}`, type: 'text', text: '片段' }] }
          : {}),
      }),
    );
    const snapshotIds = new Set(messages.filter((_, index) => index % 2 === 0).map((m) => m.id));
    const index = new SnapshotDuplicateIndex(snapshotIds);
    const output: ChatMessage[] = [];
    for (const candidate of messages) {
      const expected = output.findIndex((existing) =>
        snapshotIds.has(existing.id) && snapshotIds.has(candidate.id)
          ? areStronglyIdenticalMessages(existing, candidate)
          : areLogicalMessageDuplicates(existing, candidate),
      );
      expect(index.find(candidate, output)).toBe(expected);
      index.register(output.length, candidate);
      output.push(candidate);
    }
  });

  it('独立快照候选不会读取其它历史消息的正文', () => {
    let contentReads = 0;
    const output = Array.from({ length: 1000 }, (_, position) =>
      message(`server-${position}`, {
        get content() {
          contentReads += 1;
          return '正文';
        },
      }),
    );
    const index = new SnapshotDuplicateIndex(new Set([...output.map((m) => m.id), 'next']));
    output.forEach((entry, position) => index.register(position, entry));
    contentReads = 0;

    expect(index.find(message('next'), output)).toBe(-1);
    expect(contentReads).toBe(0);
  });
});
