import { describe, expect, it } from 'vitest';
import {
  normalizeChatMessages,
  parseAssistantTraceContent,
  parseCopiedToolCardContent,
} from './support.js';

describe('normalizeChatMessages', () => {
  it('keeps tool calls and tool results inside a single assistant message', () => {
    const messages = normalizeChatMessages([
      {
        id: 'assistant-1',
        role: 'assistant',
        createdAt: 1,
        content: [
          {
            type: 'tool_call',
            toolCallId: 'call-1',
            toolName: 'web_search',
            input: { query: '上海天气' },
          },
        ],
      },
      {
        id: 'tool-1',
        role: 'tool',
        createdAt: 2,
        content: [
          {
            type: 'tool_result',
            toolCallId: 'call-1',
            output: { city: '上海', weather: '晴' },
            isError: false,
          },
        ],
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: 'assistant',
      toolCallCount: 1,
    });
    const assistantTrace = parseAssistantTraceContent(messages[0]?.content ?? '');
    expect(assistantTrace?.text).toBe('');
    expect(assistantTrace?.toolCalls).toEqual([
      {
        toolCallId: 'call-1',
        toolName: 'web_search',
        input: { query: '上海天气' },
        output: { city: '上海', weather: '晴' },
        isError: false,
        status: 'completed',
      },
    ]);
  });

  it('extracts readable text from mixed document-like content blocks', () => {
    const messages = normalizeChatMessages([
      {
        id: 'assistant-doc',
        role: 'assistant',
        createdAt: 1,
        content: [
          { type: 'output_text', text: '# 文档标题' },
          { markdown: '第一段' },
          '/home/await/project/OpenAWork',
          { command: 'pnpm install' },
          { value: 'pnpm dev' },
          { type: 'tool_call', toolCallId: 'call-1', toolName: 'bash', input: { command: 'pwd' } },
        ],
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toContain('# 文档标题');
    expect(messages[0]?.content).toContain('第一段');
    expect(messages[0]?.content).toContain('/home/await/project/OpenAWork');
    expect(messages[0]?.content).toContain('pnpm install');
    expect(messages[0]?.content).toContain('pnpm dev');
    expect(messages[0]?.content).not.toContain('[object Object]');
  });

  it('keeps pending-permission tool results paused after message normalization', () => {
    const messages = normalizeChatMessages([
      {
        id: 'assistant-perm',
        role: 'assistant',
        createdAt: 1,
        content: [
          {
            type: 'tool_call',
            toolCallId: 'call-1',
            toolName: 'task',
            input: { prompt: 'inspect workspace' },
          },
        ],
      },
      {
        id: 'tool-perm',
        role: 'tool',
        createdAt: 2,
        content: [
          {
            type: 'tool_result',
            toolCallId: 'call-1',
            output: 'waiting for approval',
            isError: false,
            pendingPermissionRequestId: 'perm-1',
          },
        ],
      },
    ]);

    const assistantTrace = parseAssistantTraceContent(messages[0]?.content ?? '');
    expect(assistantTrace?.toolCalls).toEqual([
      {
        toolCallId: 'call-1',
        toolName: 'task',
        input: { prompt: 'inspect workspace' },
        output: 'waiting for approval',
        isError: false,
        pendingPermissionRequestId: 'perm-1',
        status: 'paused',
      },
    ]);
  });

  it('matches tool results by toolCallId even when the same tool repeats with identical input', () => {
    const messages = normalizeChatMessages([
      {
        id: 'assistant-repeat',
        role: 'assistant',
        createdAt: 1,
        content: [
          {
            type: 'tool_call',
            toolCallId: 'call-1',
            toolName: 'web_search',
            input: { query: '上海天气' },
          },
          {
            type: 'tool_call',
            toolCallId: 'call-2',
            toolName: 'web_search',
            input: { query: '上海天气' },
          },
        ],
      },
      {
        id: 'tool-repeat-1',
        role: 'tool',
        createdAt: 2,
        content: [
          {
            type: 'tool_result',
            toolCallId: 'call-2',
            output: { city: '上海', weather: '雨' },
            isError: false,
          },
        ],
      },
    ]);

    const assistantTrace = parseAssistantTraceContent(messages[0]?.content ?? '');
    expect(assistantTrace?.toolCalls).toHaveLength(2);
    expect(assistantTrace?.toolCalls[0]).toMatchObject({
      toolCallId: 'call-1',
      toolName: 'web_search',
      input: { query: '上海天气' },
      status: 'running',
    });
    expect(assistantTrace?.toolCalls[1]).toMatchObject({
      toolCallId: 'call-2',
      toolName: 'web_search',
      input: { query: '上海天气' },
      output: { city: '上海', weather: '雨' },
      isError: false,
      status: 'completed',
    });
  });

  it('preserves modified_files_summary from assistant content into assistant_trace payload', () => {
    const messages = normalizeChatMessages([
      {
        id: 'assistant-summary',
        role: 'assistant',
        createdAt: 1,
        content: [
          { type: 'text', text: '已经完成本轮修改。' },
          {
            type: 'modified_files_summary',
            title: '本轮修改了 2 个文件',
            summary: 'src/example.ts · +2 / -1 · src/feature.ts · +1 / -0',
            files: [
              {
                file: 'src/example.ts',
                before: 'const a = 1;\nconst b = 2;',
                after: 'const a = 1;\nconst b = 3;\nconst c = 4;',
                additions: 2,
                deletions: 1,
                status: 'modified',
              },
              {
                file: 'src/feature.ts',
                before: '',
                after: 'export const feature = true;',
                additions: 1,
                deletions: 0,
                status: 'added',
              },
            ],
          },
          {
            type: 'tool_call',
            toolCallId: 'call-1',
            toolName: 'apply_patch',
            input: { patchText: '*** Begin Patch' },
          },
        ],
      },
    ]);

    expect(messages[0]?.modifiedFilesSummary).toMatchObject({
      title: '本轮修改了 2 个文件',
      files: [
        expect.objectContaining({ file: 'src/example.ts', additions: 2, deletions: 1 }),
        expect.objectContaining({ file: 'src/feature.ts', additions: 1, deletions: 0 }),
      ],
    });

    const assistantTrace = parseAssistantTraceContent(messages[0]?.content ?? '');
    expect(assistantTrace?.modifiedFilesSummary).toMatchObject({
      title: '本轮修改了 2 个文件',
      summary: 'src/example.ts · +2 / -1 · src/feature.ts · +1 / -0',
    });
    expect(assistantTrace?.toolCalls[0]).toMatchObject({
      toolName: 'apply_patch',
      toolCallId: 'call-1',
    });
  });

  it('recovers copied tool card text into a structured tool call', () => {
    const copiedText = `工具：todowrite
类型：TOOL
状态：完成
摘要：2 项待办

输入
{
  "todos": [
    {
      "content": "Inspect repository architecture using child agent(s)",
      "priority": "high",
      "status": "in_progress"
    },
    {
      "content": "Summarize findings for the user after child agent reports back",
      "priority": "high",
      "status": "pending"
    }
  ]
}

输出
{
  "title": "2 todos",
  "output": "[]",
  "metadata": {
    "todos": [
      {
        "content": "Inspect repository architecture using child agent(s)",
        "status": "in_progress",
        "priority": "high"
      }
    ]
  }
}`;

    expect(parseCopiedToolCardContent(copiedText)).toMatchObject({
      toolName: 'todowrite',
      kind: 'tool',
      status: 'completed',
      input: {
        todos: [
          {
            content: 'Inspect repository architecture using child agent(s)',
            priority: 'high',
            status: 'in_progress',
          },
          {
            content: 'Summarize findings for the user after child agent reports back',
            priority: 'high',
            status: 'pending',
          },
        ],
      },
      output: {
        title: '2 todos',
      },
    });

    const messages = normalizeChatMessages([
      {
        id: 'assistant-copied-card',
        role: 'assistant',
        createdAt: 1,
        content: copiedText,
      },
    ]);

    expect(messages).toHaveLength(1);
    const assistantTrace = parseAssistantTraceContent(messages[0]?.content ?? '');
    expect(assistantTrace?.toolCalls).toMatchObject([
      {
        toolName: 'todowrite',
        kind: 'tool',
        status: 'completed',
      },
    ]);
  });
});
