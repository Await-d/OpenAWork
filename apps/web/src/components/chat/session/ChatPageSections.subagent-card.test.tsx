/**
 * 消息流子代理卡片 → 点击打开右侧面板的接线测试。
 *
 * 覆盖两层契约：
 * 1. `ChatPageSections` 把 `subagent`（规范名）等子代理工具名路由到
 *    `TaskToolInline`，而不是普通工具卡片；
 * 2. 卡片能拿到子会话 id 时把点击原样回传给 `onOpenChildSession`
 *    （聊天页据此打开右侧「代理」面板预览）。
 *
 * 子会话 id 的解析口径本身由 shared-ui 的 `ToolCallCard.test` 与
 * `subagent-tool-names.test` 直连真实实现覆盖，这里只做接线断言。
 */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let currentDisplayData: Record<string, unknown> = {};

vi.mock('@openAwork/shared-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openAwork/shared-ui')>();
  return {
    BashTerminalCard: () => null,
    GenerativeUIRenderer: () => null,
    ToolGlyph: () => <span data-testid="tool-glyph" />,
    ToolKindIcon: () => <span data-testid="tool-kind-icon" />,
    UnifiedCodeDiff: () => null,
    getProviderUiList: () => [],
    // 设计 token 转发真实实现（与 shared-ui alias mock 的既有策略一致）。
    tokens: actual.tokens,
    // 子代理工具名判定 / 子会话 id 提取转发真实实现（纯函数）。
    isSubagentToolName: actual.isSubagentToolName,
    resolveSubagentSessionIdFromToolOutput: actual.resolveSubagentSessionIdFromToolOutput,
    resolveToolCallCardDisplayData: () => currentDisplayData,
  };
});

import type { ChatMessage, ChatToolPart } from '../../conversation-runtime/messages/support.js';
import { renderChatMessageContentWithOptions } from './ChatPageSections.js';

function buildSubagentPart(overrides?: Partial<ChatToolPart>): ChatToolPart {
  return {
    id: 'tool-call-subagent-1',
    type: 'tool',
    toolCallId: 'tool-call-subagent-1',
    toolName: 'subagent',
    input: { prompt: '调查 foo', subagent_type: 'explore' },
    output: { taskId: 't1', sessionId: 'ses_msg_1', status: 'completed' },
    status: 'completed',
    ...overrides,
  };
}

function buildMessage(part: ChatToolPart): ChatMessage {
  return {
    id: 'assistant-subagent',
    role: 'assistant',
    content: '',
    parts: [part],
    status: 'completed',
  };
}

beforeEach(() => {
  currentDisplayData = {
    taskMeta: {
      agentType: 'explore',
      outputSessionId: 'ses_msg_1',
      readonly: false,
      hasAdditionalInputFields: false,
    },
    taskSummary: { title: '调查 foo' },
    summary: '调查 foo',
    displayToolName: '子代理任务',
    showInputField: true,
    hasDetails: true,
  };
});

afterEach(() => {
  cleanup();
});

describe('消息流子代理卡片点击 → 打开子代理预览', () => {
  it('规范名 subagent 渲染为可点击卡片并回传输出里的子会话 id', () => {
    const onOpenChildSession = vi.fn();
    const { container } = render(
      <>
        {renderChatMessageContentWithOptions(buildMessage(buildSubagentPart()), {
          onOpenChildSession,
        })}
      </>,
    );

    const card = container.querySelector<HTMLElement>('[data-chat-task-inline="true"]');
    expect(card).not.toBeNull();
    expect(card?.tagName).toBe('BUTTON');
    expect(card?.getAttribute('data-clickable')).toBe('true');

    fireEvent.click(card as HTMLElement);
    expect(onOpenChildSession).toHaveBeenCalledWith('ses_msg_1');
  });

  it('已选中的子代理展示选中态（用于面板高亮联动）', () => {
    const { container } = render(
      <>
        {renderChatMessageContentWithOptions(buildMessage(buildSubagentPart()), {
          onOpenChildSession: () => undefined,
          selectedChildSessionId: 'ses_msg_1',
        })}
      </>,
    );

    const card = container.querySelector<HTMLElement>('[data-chat-task-inline="true"]');
    expect(card?.getAttribute('data-selected')).toBe('true');
    expect(container.querySelector('.chat-task-inline-hint')?.textContent).toBe('正在查看');
  });

  it('精简分支（displayData 无 taskMeta）仍从文本输出解析并回传子会话 id', () => {
    currentDisplayData = {
      taskMeta: undefined,
      taskSummary: undefined,
      summary: '代理委派',
      displayToolName: 'call_omo_agent',
      showInputField: false,
      hasDetails: false,
    };
    const onOpenChildSession = vi.fn();
    const { container } = render(
      <>
        {renderChatMessageContentWithOptions(
          buildMessage(
            buildSubagentPart({
              toolName: 'call_omo_agent',
              input: { prompt: '跑一下', subagent_type: 'explore' },
              output: '<subagent sessionID="ses_msg_2" state="completed">done</subagent>',
            }),
          ),
          { onOpenChildSession },
        )}
      </>,
    );

    const card = container.querySelector<HTMLElement>('[data-chat-task-inline="true"]');
    expect(card?.tagName).toBe('BUTTON');

    fireEvent.click(card as HTMLElement);
    expect(onOpenChildSession).toHaveBeenCalledWith('ses_msg_2');
  });

  it('没有 onOpenChildSession 时卡片保持不可点击（纯展示）', () => {
    const { container } = render(
      <>{renderChatMessageContentWithOptions(buildMessage(buildSubagentPart()))}</>,
    );

    const card = container.querySelector<HTMLElement>('[data-chat-task-inline="true"]');
    expect(card?.tagName).toBe('DIV');
    expect(card?.getAttribute('data-clickable')).toBe('false');
  });
});
