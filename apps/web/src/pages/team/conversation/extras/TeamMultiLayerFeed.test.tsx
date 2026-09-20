// @vitest-environment jsdom
/**
 * TeamMultiLayerFeed · rawListToEntries 流式分流
 *
 * 约定：层数据里的流式占位消息（LayerMessages.streamingMessage，status === 'streaming'）
 * 必须走流式渲染管线 —— 输出流式光标（.assistant-rich-content-cursor）并在流式期间
 * 禁用围栏块折叠；已定稿消息仍走常规渲染管线（整条折叠 + markdown）。
 *
 * rawListToEntries 是纯函数，renderContent 返回的是普通 ReactNode，直接渲染它即可
 * 验证分流结果，无需挂载整个 feed（也就不需要 provider / zustand store 等重装配）。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ChatMessage } from '../../../../components/conversation-runtime/messages/support.js';
import type { LayerMessages } from './team-layer-messages.js';
import {
  rawListToEntries,
  resolveRawListOrdering,
  type RawMessageItem,
} from './TeamMultiLayerFeed.js';

vi.mock('../../../../components/chat/markdown/markdown-message-content.js', () => ({
  // 流式管线走 MarkdownCore，静态管线走默认导出，两个出口都必须桩。
  default: ({ content }: { content: string }) => <div data-testid="md">{content}</div>,
  MarkdownCore: ({ content }: { content: string }) => <div data-testid="md">{content}</div>,
}));

afterEach(() => {
  cleanup();
});

function makeLayer(
  overrides: Partial<LayerMessages> & Pick<LayerMessages, 'layer'>,
): LayerMessages {
  return {
    messages: [],
    sessionIds: ['session-1'],
    isActive: false,
    ...overrides,
  };
}

function makeRawItem(message: ChatMessage, layer: LayerMessages): RawMessageItem {
  return { message, layerData: layer, timestamp: 1, layerIndex: 0, inLayerIndex: 0 };
}

function message(id: string, createdAt?: number | string): ChatMessage {
  return {
    id,
    role: 'assistant',
    content: id,
    ...(createdAt === undefined ? {} : { createdAt }),
  };
}

describe('TeamMultiLayerFeed · rawListToEntries 流式分流', () => {
  it('流式占位消息走流式渲染管线，输出流式光标', () => {
    const streaming: ChatMessage = {
      id: 'stream-1',
      role: 'assistant',
      content: '正在输出的正文',
      status: 'streaming',
    };

    const entries = rawListToEntries([makeRawItem(streaming, makeLayer({ layer: 'executor' }))]);
    const entry = entries[0];
    expect(entry).toBeDefined();

    const { container } = render(<>{entry?.renderContent(streaming)}</>);

    expect(container.querySelector('.assistant-rich-content-cursor')).not.toBeNull();
  });

  it('已定稿消息走常规渲染管线，不出现流式光标', () => {
    const finalized: ChatMessage = {
      id: 'final-1',
      role: 'assistant',
      content: '已完成的正文',
      status: 'completed',
    };

    const entries = rawListToEntries([makeRawItem(finalized, makeLayer({ layer: 'executor' }))]);
    const entry = entries[0];
    expect(entry).toBeDefined();

    const { container } = render(<>{entry?.renderContent(finalized)}</>);

    expect(container.querySelector('.assistant-rich-content-cursor')).toBeNull();
    expect(container.textContent).toContain('已完成的正文');
  });
});

describe('TeamMultiLayerFeed · resolveRawListOrdering 合并顺序', () => {
  it('跨层按可比时间戳交错，而不是逐层首尾拼接', () => {
    const layerA = makeLayer({
      layer: 'executor',
      messages: [message('a0', 10), message('a1', 30)],
    });
    const layerB = makeLayer({ layer: 'tester', messages: [message('b0', 20)] });

    const ids = resolveRawListOrdering([layerA, layerB]).map((item) => item.message.id);

    expect(ids).toEqual(['a0', 'b0', 'a1']);
    expect(ids).not.toEqual(['a0', 'a1', 'b0']);
  });

  it('流式占位消息停在自己这一层的末尾，不回退到全局底部', () => {
    const layerA = makeLayer({
      layer: 'executor',
      messages: [message('a0', 10)],
      streamingMessage: message('live', 9_999_999_999),
    });
    const layerB = makeLayer({
      layer: 'tester',
      messages: [message('b0', 20), message('b1', 30)],
    });

    const ids = resolveRawListOrdering([layerA, layerB]).map((item) => item.message.id);

    expect(ids).toEqual(['a0', 'live', 'b0', 'b1']);
    expect(ids[ids.length - 1]).not.toBe('live');
  });

  it('ISO-8601 字符串 createdAt 按真实时刻排序', () => {
    const later = makeLayer({
      layer: 'executor',
      messages: [message('later', '2026-01-02T03:04:05.000Z')],
    });
    const earlier = makeLayer({
      layer: 'tester',
      messages: [message('earlier', '2026-01-01T00:00:00.000Z')],
    });

    const ids = resolveRawListOrdering([later, earlier]).map((item) => item.message.id);

    expect(ids).toEqual(['earlier', 'later']);
  });

  it('缺失时间戳的消息不被顶到最前，而是继承所在层的位置', () => {
    const layerA = makeLayer({
      layer: 'executor',
      messages: [message('a0', 5_000), message('a-missing')],
    });
    const layerB = makeLayer({ layer: 'tester', messages: [message('b0', 1_000)] });

    const ids = resolveRawListOrdering([layerA, layerB]).map((item) => item.message.id);

    expect(ids).toEqual(['b0', 'a0', 'a-missing']);
    expect(ids[0]).not.toBe('a-missing');
  });

  it('层首缺失时间戳回填本层首个可比时间戳，同样不被顶到最前', () => {
    const layerA = makeLayer({
      layer: 'executor',
      messages: [message('a-missing'), message('a1', 5_000)],
    });
    const layerB = makeLayer({ layer: 'tester', messages: [message('b0', 1_000)] });

    const ids = resolveRawListOrdering([layerA, layerB]).map((item) => item.message.id);

    expect(ids).toEqual(['b0', 'a-missing', 'a1']);
  });

  it('跨层时间戳相同 → 按 (层级下标, 层内下标) 得到确定的全序', () => {
    const layerA = makeLayer({
      layer: 'executor',
      messages: [message('a0', 100), message('a1', 100)],
    });
    const layerB = makeLayer({ layer: 'tester', messages: [message('b0', 100)] });
    const layerC = makeLayer({ layer: 'reviewer', messages: [message('c0', 100)] });

    const ids = resolveRawListOrdering([layerA, layerB, layerC]).map((item) => item.message.id);

    expect(ids).toEqual(['a0', 'a1', 'b0', 'c0']);
  });
});
