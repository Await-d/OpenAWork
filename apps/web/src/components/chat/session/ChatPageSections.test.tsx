// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createAssistantTraceContent,
  type ChatMessage,
} from '../../conversation-runtime/messages/support.js';
import { useDisplayPreferencesStore } from '../../../stores/settings/display-preferences.js';
import {
  renderChatMessageContentWithOptions,
  renderStreamingChatMessageContentWithOptions,
} from './ChatPageSections.js';

afterEach(() => {
  cleanup();
  useDisplayPreferencesStore.setState({ showReasoningBlock: true });
});

describe('renderChatMessageContentWithOptions', () => {
  it('chat 模式隐藏推理时仍保留简化后的占位提示', () => {
    useDisplayPreferencesStore.setState({ showReasoningBlock: false });

    const message: ChatMessage = {
      id: 'assistant-parts-chat',
      role: 'assistant',
      content: '',
      parts: [{ id: 'reasoning-1', type: 'reasoning', text: '先判断入口，再确认渲染分支。' }],
    };

    render(<>{renderChatMessageContentWithOptions(message, { presentationMode: 'chat' })}</>);

    expect(screen.getByText('思考过程')).not.toBeNull();
    expect(screen.getByText('已完成')).not.toBeNull();
  });

  it('team 模式隐藏推理时不展示 chat 专属占位提示', () => {
    useDisplayPreferencesStore.setState({ showReasoningBlock: false });

    const message: ChatMessage = {
      id: 'assistant-trace-team',
      role: 'assistant',
      content: createAssistantTraceContent({
        reasoningBlocks: ['先整理上下文，再继续执行。'],
        text: '',
        toolCalls: [],
      }),
    };

    render(<>{renderChatMessageContentWithOptions(message, { presentationMode: 'team' })}</>);

    expect(screen.queryByText('思考过程')).toBeNull();
    expect(screen.queryByText('已完成')).toBeNull();
  });

  it('parts 路径把同一条消息的多个思考块合并为单个展示块', () => {
    const message: ChatMessage = {
      id: 'assistant-multi-reasoning-parts',
      role: 'assistant',
      content: '',
      parts: [
        { id: 'reasoning-1', type: 'reasoning', text: '第一段推理' },
        { id: 'reasoning-2', type: 'reasoning', text: '第二段推理' },
      ],
      reasoningBlocksEndedFlags: [true, true],
      reasoningBlocksDurationsMs: [200, 100],
    };

    render(<>{renderChatMessageContentWithOptions(message, { presentationMode: 'chat' })}</>);

    const blocks = document.querySelectorAll('.assistant-reasoning-block');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.getAttribute('data-duration-ms')).toBe('300');
    expect(blocks[0]?.getAttribute('data-ended')).toBe('true');
    expect(blocks[0]?.textContent).toContain('第一段推理');
    expect(blocks[0]?.textContent).toContain('第二段推理');
  });

  it('trace 路径把同一条消息的多个思考块合并为单个展示块', () => {
    const message: ChatMessage = {
      id: 'assistant-multi-reasoning-trace',
      role: 'assistant',
      content: createAssistantTraceContent({
        reasoningBlocks: ['trace 第一段', 'trace 第二段'],
        reasoningBlocksTimings: [
          { startedAt: 100, endedAt: 300 },
          { startedAt: 300, endedAt: 500 },
        ],
        text: '',
        toolCalls: [],
      }),
    };

    render(<>{renderChatMessageContentWithOptions(message, { presentationMode: 'chat' })}</>);

    const blocks = document.querySelectorAll('.assistant-reasoning-block');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.getAttribute('data-duration-ms')).toBe('400');
    expect(blocks[0]?.textContent).toContain('trace 第一段');
    expect(blocks[0]?.textContent).toContain('trace 第二段');
  });

  it('流式 parts 路径只在活动尾部文本段绘制一个光标', () => {
    const message: ChatMessage = {
      id: 'assistant-interleaved-parts',
      role: 'assistant',
      content: '',
      parts: [
        { id: 'text-1', type: 'text', text: '前一段正文。' },
        { id: 'reasoning-1', type: 'reasoning', text: '中途再想一下。' },
        { id: 'text-2', type: 'text', text: '后一段正文。' },
      ],
      reasoningBlocksEndedFlags: [false],
    };

    render(
      <>{renderStreamingChatMessageContentWithOptions(message, { presentationMode: 'chat' })}</>,
    );

    const bodies = document.querySelectorAll('.assistant-rich-content-body');
    const cursorOwners = document.querySelectorAll(
      '.assistant-rich-content-body[data-streaming="true"]',
    );
    // 只有一个光标，且挂在 DOM 顺序里的最后一个文本段（text-2）上。
    expect(cursorOwners).toHaveLength(1);
    expect(cursorOwners[0]).toBe(bodies[bodies.length - 1]);
  });

  it('流式 parts 路径在尾部为非文本段时仍保留单个光标', () => {
    const message: ChatMessage = {
      id: 'assistant-trailing-reasoning-parts',
      role: 'assistant',
      content: '',
      parts: [
        { id: 'text-1', type: 'text', text: '先给出的正文。' },
        { id: 'reasoning-1', type: 'reasoning', text: '随后继续思考。' },
      ],
      reasoningBlocksEndedFlags: [false],
    };

    render(
      <>{renderStreamingChatMessageContentWithOptions(message, { presentationMode: 'chat' })}</>,
    );

    const bodies = document.querySelectorAll('.assistant-rich-content-body');
    const cursorOwners = document.querySelectorAll(
      '.assistant-rich-content-body[data-streaming="true"]',
    );
    // 尾部是推理块（不绘制光标），光标仍落在最后一个非空文本段（text-1）上，不退化为零。
    expect(cursorOwners).toHaveLength(1);
    expect(cursorOwners[0]).toBe(bodies[0]);
  });
});
