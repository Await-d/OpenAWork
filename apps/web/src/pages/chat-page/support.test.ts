import { describe, expect, it } from 'vitest';
import {
  createAssistantEventContent,
  normalizeChatMessages,
  parseAssistantTraceContent,
  parseCopiedToolCardContent,
  reconcileSnapshotChatMessages,
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
            toolName: 'task',
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

  it('uses durable tool_result.toolName when no matching tool_call exists', () => {
    const messages = normalizeChatMessages([
      {
        id: 'tool-only',
        role: 'tool',
        createdAt: 2,
        content: [
          {
            type: 'tool_result',
            toolCallId: 'call-tool-only',
            toolName: 'codesearch',
            output: 'snippet',
            isError: false,
          },
        ],
      },
    ]);

    const assistantTrace = parseAssistantTraceContent(messages[0]?.content ?? '');
    expect(assistantTrace?.toolCalls[0]).toMatchObject({
      toolCallId: 'call-tool-only',
      toolName: 'codesearch',
      output: 'snippet',
    });
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

  it('keeps reasoning parts separate from assistant final text during normalization', () => {
    const messages = normalizeChatMessages([
      {
        id: 'assistant-reasoning',
        role: 'assistant',
        createdAt: 1,
        content: [
          { type: 'reasoning', text: '## 先比较约束\n- 需要兼容流式' },
          { type: 'text', text: '这是最终答复。' },
        ],
      },
    ]);

    expect(messages).toHaveLength(1);
    const assistantTrace = parseAssistantTraceContent(messages[0]?.content ?? '');
    expect(assistantTrace?.reasoningBlocks).toEqual(['## 先比较约束\n- 需要兼容流式']);
    expect(assistantTrace?.text).toBe('这是最终答复。');
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

  it('normalizes localized Claude-first copied tool names back to canonical names', () => {
    const copiedText = `工具：询问用户
类型：TOOL
状态：等待回答
摘要：执行策略 · 请选择继续方式 · 2 个选项 · 单选

输入
{
  "questions": [
    {
      "question": "请选择继续方式",
      "header": "执行策略",
      "options": [
        { "label": "继续", "description": "继续执行" },
        { "label": "暂停", "description": "暂停执行" }
      ]
    }
  ]
}

输出
"waiting for answer"`;

    expect(parseCopiedToolCardContent(copiedText)).toMatchObject({
      toolName: 'AskUserQuestion',
      status: 'paused',
      input: {
        questions: [
          {
            question: '请选择继续方式',
            header: '执行策略',
          },
        ],
      },
    });
  });

  it('keeps the local tail when a same-session snapshot is only a prefix of current messages', () => {
    const previousMessages = [
      {
        id: 'assistant-seed',
        role: 'assistant' as const,
        content: '历史消息',
        createdAt: 1,
        status: 'completed' as const,
      },
      {
        id: 'local-user',
        role: 'user' as const,
        content: '继续分析',
        createdAt: 2_000,
        status: 'completed' as const,
      },
      {
        id: 'local-assistant',
        role: 'assistant' as const,
        content: '这是本地刚补上的结论',
        createdAt: 3_000,
        status: 'completed' as const,
      },
    ];
    const snapshotMessages = [
      {
        id: 'assistant-seed',
        role: 'assistant' as const,
        content: '历史消息',
        createdAt: 1,
        status: 'completed' as const,
      },
      {
        id: 'server-user',
        role: 'user' as const,
        content: '继续分析',
        createdAt: 2_005,
        status: 'completed' as const,
      },
    ];

    expect(reconcileSnapshotChatMessages(previousMessages, snapshotMessages)).toEqual(
      previousMessages,
    );
  });

  it('falls back to the server snapshot when the same-session history diverges midstream', () => {
    const previousMessages = [
      {
        id: 'assistant-seed',
        role: 'assistant' as const,
        content: '历史消息',
        createdAt: 1,
        status: 'completed' as const,
      },
      {
        id: 'local-user',
        role: 'user' as const,
        content: '继续分析',
        createdAt: 2_000,
        status: 'completed' as const,
      },
      {
        id: 'local-assistant',
        role: 'assistant' as const,
        content: '本地临时尾部',
        createdAt: 3_000,
        status: 'completed' as const,
      },
    ];
    const snapshotMessages = [
      {
        id: 'assistant-seed',
        role: 'assistant' as const,
        content: '历史消息',
        createdAt: 1,
        status: 'completed' as const,
      },
      {
        id: 'server-user',
        role: 'user' as const,
        content: '服务端已经截断后的新问题',
        createdAt: 2_000,
        status: 'completed' as const,
      },
    ];

    expect(reconcileSnapshotChatMessages(previousMessages, snapshotMessages)).toEqual(
      snapshotMessages,
    );
  });
});

describe('createAssistantEventContent', () => {
  it('renders question waiting events as paused assistant cards', () => {
    const content = createAssistantEventContent({
      type: 'question_asked',
      requestId: 'question-1',
      toolName: 'question',
      title: '请选择要查看的目录',
      eventId: 'evt-question-1',
      runId: 'run-question-1',
      occurredAt: 10,
    });

    expect(content).toContain('等待回答 · question');
    expect(content).toContain('请选择要查看的目录');
  });

  it('renders answered question events as success assistant cards', () => {
    const content = createAssistantEventContent({
      type: 'question_replied',
      requestId: 'question-1',
      status: 'answered',
      eventId: 'evt-question-2',
      runId: 'run-question-1',
      occurredAt: 11,
    });

    expect(content).toContain('问题已响应');
    expect(content).toContain('已回答，继续执行。');
  });
});
