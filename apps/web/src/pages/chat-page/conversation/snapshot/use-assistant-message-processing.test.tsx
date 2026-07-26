// @vitest-environment jsdom
import React, { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { RunEvent } from '@openAwork/shared';
import type { ChatMessage } from '../../../../components/conversation-runtime/messages/support.js';
import { useAssistantMessageProcessing } from './use-assistant-message-processing.js';

const emptyCatalog = {
  agents: [],
  installedSkills: [],
  mcpServers: [],
  agentTools: [],
} as never;

describe('useAssistantMessageProcessing compaction', () => {
  it('appends compaction events into the main transcript as GenerativeUI cards', () => {
    const { result } = renderHook(() => {
      const [messages, setMessages] = useState<ChatMessage[]>([]);
      const processing = useAssistantMessageProcessing({
        composerWorkspaceCatalog: emptyCatalog,
        setMessages,
      });
      return { messages, processing };
    });

    act(() => {
      result.current.processing.appendAssistantEventMessages([
        {
          type: 'compaction',
          summary: '压缩了较早的 12 条消息',
          trigger: 'automatic',
          compactedMessages: 12,
          representedMessages: 12,
          cause: 'proactive_near_overflow',
          strategy: 'summary_only',
          occurredAt: 1_700_000_000_000,
        } satisfies Extract<RunEvent, { type: 'compaction' }>,
      ]);
    });

    expect(result.current.messages).toHaveLength(1);
    const message = result.current.messages[0]!;
    expect(message.role).toBe('assistant');
    const parsed = JSON.parse(message.content) as {
      type?: string;
      payload?: Record<string, unknown>;
    };
    expect(parsed.type).toBe('compaction');
    expect(parsed.payload?.['title']).toBe('compact');
    expect(String(parsed.payload?.['summary'] ?? '')).toContain('压缩了较早的 12 条消息');
    expect(String(parsed.payload?.['summary'] ?? '')).toContain('压缩 12 条');
    expect(parsed.payload?.['trigger']).toBe('automatic');
  });

  it('用同一个 runId 将压缩中更新为完成状态，不追加第二条消息', () => {
    const { result } = renderHook(() => {
      const [messages, setMessages] = useState<ChatMessage[]>([]);
      const processing = useAssistantMessageProcessing({
        composerWorkspaceCatalog: emptyCatalog,
        setMessages,
      });
      return { messages, processing };
    });

    act(() => {
      result.current.processing.appendAssistantEventMessages([
        {
          type: 'compaction',
          summary: '正在压缩会话上下文。',
          trigger: 'manual',
          phase: 'started',
          cause: 'manual',
          strategy: 'runtime_replace',
          runId: 'command:session-1:slash-compact:execution-1',
          eventId: 'session-1:slash-compact:execution-1:compaction:started',
          occurredAt: 1_700_000_000_000,
        },
      ]);
    });

    const startedId = result.current.messages[0]?.id;
    expect(result.current.messages).toHaveLength(1);
    expect(startedId).toBe(
      'assistant_event:compaction:command:session-1:slash-compact:execution-1',
    );

    act(() => {
      result.current.processing.appendAssistantEventMessages([
        {
          type: 'compaction',
          summary: '已压缩较早消息。',
          trigger: 'manual',
          phase: 'completed',
          cause: 'manual',
          strategy: 'runtime_replace',
          compactedMessages: 12,
          representedMessages: 12,
          runId: 'command:session-1:slash-compact:execution-1',
          eventId: 'session-1:slash-compact:execution-1:compaction:completed',
          occurredAt: 1_700_000_000_500,
        },
      ]);
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]?.id).toBe(startedId);
    const parsed = JSON.parse(result.current.messages[0]!.content) as {
      payload?: Record<string, unknown>;
    };
    expect(parsed.payload?.['phase']).toBe('completed');
    expect(parsed.payload?.['summary']).toContain('已压缩较早消息');
  });

  it('压缩请求失败时将同一条消息更新为失败提示', () => {
    const { result } = renderHook(() => {
      const [messages, setMessages] = useState<ChatMessage[]>([]);
      const processing = useAssistantMessageProcessing({
        composerWorkspaceCatalog: emptyCatalog,
        setMessages,
      });
      return { messages, processing };
    });

    act(() => {
      result.current.processing.appendAssistantEventMessages([
        {
          type: 'compaction',
          summary: '正在压缩会话上下文。',
          trigger: 'manual',
          phase: 'started',
          cause: 'manual',
          strategy: 'runtime_replace',
          runId: 'command:session-1:slash-compact:execution-1',
          eventId: 'session-1:slash-compact:execution-1:compaction:started',
        },
        {
          type: 'compaction',
          summary: '网络异常，执行命令失败。',
          trigger: 'manual',
          phase: 'failed',
          cause: 'manual',
          strategy: 'runtime_replace',
          runId: 'command:session-1:slash-compact:execution-1',
          eventId: 'session-1:slash-compact:execution-1:compaction:request-failed',
        },
      ]);
    });

    expect(result.current.messages).toHaveLength(1);
    const parsed = JSON.parse(result.current.messages[0]!.content) as {
      payload?: Record<string, unknown>;
    };
    expect(parsed.payload?.['phase']).toBe('failed');
    expect(parsed.payload?.['summary']).toContain('网络异常');
  });

  it('不同 executionId 的压缩各自保留独立消息，不覆盖历史卡片', () => {
    const { result } = renderHook(() => {
      const [messages, setMessages] = useState<ChatMessage[]>([]);
      const processing = useAssistantMessageProcessing({
        composerWorkspaceCatalog: emptyCatalog,
        setMessages,
      });
      return { messages, processing };
    });

    act(() => {
      result.current.processing.appendAssistantEventMessages([
        {
          type: 'compaction',
          summary: '第一次压缩完成',
          trigger: 'manual',
          phase: 'completed',
          cause: 'manual',
          strategy: 'runtime_replace',
          runId: 'command:session-1:slash-compact:execution-1',
          eventId: 'session-1:slash-compact:execution-1:compaction:completed',
          occurredAt: 1_700_000_000_000,
        },
        {
          type: 'compaction',
          summary: '第二次压缩完成',
          trigger: 'manual',
          phase: 'completed',
          cause: 'manual',
          strategy: 'runtime_replace',
          runId: 'command:session-1:slash-compact:execution-2',
          eventId: 'session-1:slash-compact:execution-2:compaction:completed',
          occurredAt: 1_700_000_001_000,
        },
      ]);
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages.map((message) => message.id)).toEqual([
      'assistant_event:compaction:command:session-1:slash-compact:execution-1',
      'assistant_event:compaction:command:session-1:slash-compact:execution-2',
    ]);
  });

  it('does not append non-compaction operational events', () => {
    const { result } = renderHook(() => {
      const [messages, setMessages] = useState<ChatMessage[]>([]);
      const processing = useAssistantMessageProcessing({
        composerWorkspaceCatalog: emptyCatalog,
        setMessages,
      });
      return { messages, processing };
    });

    act(() => {
      result.current.processing.appendAssistantEventMessages([
        {
          type: 'permission_asked',
          requestId: 'req-1',
          toolName: 'bash',
          scope: 'session',
          riskLevel: 'medium',
          reason: 'run command',
        } as never,
      ]);
    });

    expect(result.current.messages).toHaveLength(0);
  });
});
