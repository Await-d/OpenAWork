import { describe, expect, it } from 'vitest';
import type { ChatMessage } from './message-model.js';
import { normalizeChatMessages } from './normalize-chat-messages.js';
import { reconcileSnapshotChatMessages } from './snapshot-reconciliation.js';

function imageMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'local-user',
    role: 'user',
    content: '看图',
    status: 'completed',
    createdAt: 1_000,
    rawContent: [
      { type: 'text', text: '看图' },
      { type: 'input_image', artifactId: 'artifact-1', imageUrl: 'blob:local-preview' },
    ],
    ...overrides,
  };
}

describe('图片用户消息快照协调', () => {
  it.each([
    [0, '新正文'],
    [7, '新正文'],
    [7, '看图'],
  ])('同请求用户副本在位置 %s、正文 %s 时保留预览与缺失元数据', (position, content) => {
    const local = imageMessage({
      clientRequestId: 'request:full:user:1',
      model: 'local-model',
      providerId: 'local-provider',
      agentId: 'local-agent',
    });
    const preceding: ChatMessage[] = Array.from({ length: position }, (_, index) => ({
      id: `assistant-${index}`,
      role: 'assistant',
      content: `既有回复 ${index}`,
      createdAt: 100 + index,
      status: 'completed',
    }));
    const snapshot = imageMessage({
      id: 'server-user',
      clientRequestId: local.clientRequestId,
      content,
      createdAt: 17_000,
      model: 'server-model',
      providerId: undefined,
      agentId: undefined,
      rawContent: [
        { type: 'text', text: content },
        { type: 'input_image', artifactId: 'artifact-1' },
      ],
    });
    const result = reconcileSnapshotChatMessages([...preceding, local], [snapshot]);
    const users = result.filter((message) => message.role === 'user');
    expect(users).toEqual([
      {
        ...snapshot,
        providerId: 'local-provider',
        agentId: 'local-agent',
        rawContent: [
          { type: 'text', text: content },
          { type: 'input_image', artifactId: 'artifact-1', imageUrl: 'blob:local-preview' },
        ],
      },
    ]);
    expect(reconcileSnapshotChatMessages(result, [snapshot])).toBe(result);
  });

  it.each(['request:full:user:2', ''])('请求 ID 为 %s 时不凭相同图片合并不同正文', (requestId) => {
    const local = imageMessage({ clientRequestId: 'request:full:user:1' });
    const snapshot = imageMessage({
      id: 'server-user',
      clientRequestId: requestId,
      content: '新正文',
      rawContent: [
        { type: 'text', text: '新正文' },
        { type: 'input_image', artifactId: 'artifact-1' },
      ],
    });
    expect(reconcileSnapshotChatMessages([local], [snapshot])).toEqual([snapshot, local]);
  });

  it.each([null, undefined, 'legacy-content', 0])(
    '原始数组保留非结构化项 %s 时更新正文及连续刷新不抛错',
    (legacyItem) => {
      const normalize = (content: unknown[]) =>
        normalizeChatMessages([{ id: 'user', role: 'user', content, createdAt: 1_000 }]);
      const previous = normalize([
        legacyItem,
        { type: 'text', text: '旧正文' },
        { type: 'input_image', artifactId: 'artifact-1', imageUrl: 'blob:local' },
      ]);
      const content = [
        { type: 'text', text: '新正文' },
        { type: 'input_image', artifactId: 'artifact-1' },
        legacyItem,
      ];
      const first = reconcileSnapshotChatMessages(previous, normalize(content));
      expect(first[0]?.content).toBe(normalize(content)[0]?.content);
      expect(first[0]?.rawContent?.[1]).toMatchObject({ imageUrl: 'blob:local' });
      expect(first[0]?.rawContent?.[2]).toBe(legacyItem);
      expect(reconcileSnapshotChatMessages(first, normalize(content))).toBe(first);
    },
  );
  it('空项位置改变而正文相同时原始内容更新仍可回收比较', () => {
    const normalize = (content: unknown[]) =>
      normalizeChatMessages([{ id: 'user', role: 'user', content, createdAt: 1_000 }]);
    const previous = normalize([null, { type: 'text', text: '正文' }]);
    const snapshot = normalize([{ type: 'text', text: '正文' }, null]);
    const result = reconcileSnapshotChatMessages(previous, snapshot);
    expect(result[0]?.rawContent).toEqual(snapshot[0]?.rawContent);
    expect(result).not.toBe(previous);
    expect(
      reconcileSnapshotChatMessages(result, normalize([{ type: 'text', text: '正文' }, null])),
    ).toBe(result);
  });
  it.each(['artifact-1', 'artifact-2', undefined])(
    '真实数组同 ID 仅为匹配稳定图片身份 %s 补预览',
    (artifactId) => {
      const previous = normalizeChatMessages([
        {
          id: 'user',
          role: 'user',
          createdAt: 1_000,
          content: [
            { type: 'text', text: '旧正文' },
            { type: 'input_image', artifactId: 'artifact-1', imageUrl: 'blob:local' },
          ],
        },
      ]);
      const snapshot = normalizeChatMessages([
        {
          id: 'user',
          role: 'user',
          createdAt: 1_000,
          content: [
            { type: 'text', text: '新正文' },
            { type: 'input_image', artifactId },
          ],
        },
      ]);
      const result = reconcileSnapshotChatMessages(previous, snapshot);
      expect(result[0]?.content).toBe('新正文');
      expect(result[0]?.rawContent?.[0]).toEqual({ type: 'text', text: '新正文' });
      expect(result[0]?.rawContent?.[1]).toEqual({
        type: 'input_image',
        artifactId,
        ...(artifactId === 'artifact-1' ? { imageUrl: 'blob:local' } : {}),
      });
    },
  );
  it.each([16_000, 3_600_000])('不同 ID 无请求身份相差 %s 毫秒时不合并', (delay) => {
    const content = [
      { type: 'text', text: '看图' },
      { type: 'input_image', artifactId: 'artifact-1' },
    ];
    const previous = normalizeChatMessages([
      { id: 'local', role: 'user', createdAt: 1_000, content },
    ]);
    const snapshot = normalizeChatMessages([
      { id: 'server', role: 'user', createdAt: 1_000 + delay, content },
    ]);
    expect(reconcileSnapshotChatMessages(previous, snapshot)).toHaveLength(2);
  });
  it('后续同 ID 快照继续保留本地预览，并接受服务端的新预览', () => {
    const local = imageMessage({});
    const server = imageMessage({
      id: 'server',
      rawContent: [
        { type: 'text', text: '看图' },
        { type: 'input_image', artifactId: 'artifact-1' },
      ],
    });
    const first = reconcileSnapshotChatMessages([local], [server]);
    const second = reconcileSnapshotChatMessages(first, [server]);
    expect(second).toBe(first);
    expect(second[0]?.rawContent?.[1]).toMatchObject({ imageUrl: 'blob:local-preview' });
    const upgraded = imageMessage({
      ...server,
      rawContent: [
        { type: 'text', text: '看图' },
        { type: 'input_image', artifactId: 'artifact-1', imageUrl: 'https://example.test/new.png' },
      ],
    });
    const third = reconcileSnapshotChatMessages(second, [upgraded]);
    expect(third).not.toBe(second);
    expect(third[0]?.rawContent?.[1]).toMatchObject({ imageUrl: 'https://example.test/new.png' });
  });
  it.each([undefined, 'https://example.test/server-preview.png'])(
    '共享请求 ID 且相差 16 秒，同 artifact 预览为 %s 时只保留快照消息',
    (imageUrl) => {
      const local = imageMessage({ clientRequestId: 'same-request' });
      const snapshot = imageMessage({
        id: 'server-user',
        clientRequestId: 'same-request',
        createdAt: 17_000,
        rawContent: [
          { type: 'text', text: '看图' },
          { type: 'input_image', artifactId: 'artifact-1', imageUrl },
        ],
      });
      const result = reconcileSnapshotChatMessages([local], [snapshot]);
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(snapshot.id);
      expect(result[0]?.rawContent).toEqual([
        { type: 'text', text: '看图' },
        {
          type: 'input_image',
          artifactId: 'artifact-1',
          imageUrl: imageUrl ?? 'blob:local-preview',
        },
      ]);
    },
  );

  it.each([2_000, 17_000])('不同 artifact 即使同文、时间为 %s 也保持两条', (createdAt) => {
    const local = imageMessage({});
    const snapshot = imageMessage({
      id: 'server-user',
      createdAt,
      rawContent: [
        { type: 'text', text: '看图' },
        { type: 'input_image', artifactId: 'artifact-2', imageUrl: 'blob:local-preview' },
      ],
    });
    const result = reconcileSnapshotChatMessages([local], [snapshot]);
    expect(result).toHaveLength(2);
    expect(result).toEqual(expect.arrayContaining([local, snapshot]));
  });

  it('相同图片与文字、明确冲突的用户请求 ID 保持两个回合', () => {
    const local = imageMessage({ clientRequestId: 'request-a' });
    const snapshot = imageMessage({
      id: 'server-user',
      createdAt: 2_000,
      clientRequestId: 'request-b',
    });
    expect(reconcileSnapshotChatMessages([local], [snapshot])).toEqual([snapshot, local]);
  });

  it('权威快照内同文同图片的重复用户消息保留各自身份与顺序', () => {
    const first = imageMessage({ id: 'server-first' });
    const second = imageMessage({ id: 'server-second', createdAt: 2_000 });
    const snapshot = [first, second];
    expect(reconcileSnapshotChatMessages([first], snapshot)).toEqual(snapshot);
    expect(reconcileSnapshotChatMessages(snapshot, snapshot)).toEqual(snapshot);
  });

  it('已有用户回合边界时不把复用同一图片的新回合合并', () => {
    const first = imageMessage({ id: 'server-first' });
    const nextTurn = imageMessage({ id: 'server-next', content: '继续', createdAt: 2_000 });
    const repeated = imageMessage({ id: 'server-repeat', createdAt: 3_000 });
    const snapshot = [first, nextTurn, repeated];
    expect(reconcileSnapshotChatMessages([first, nextTurn], snapshot)).toEqual(snapshot);
  });
});
