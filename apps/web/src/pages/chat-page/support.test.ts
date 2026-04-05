import { describe, expect, it } from 'vitest';
import {
  clearResolvedPendingPermissionFromMessage,
  createAssistantEventContent,
  normalizeChatMessages,
  parseAssistantTraceContent,
  parseCopiedToolCardContent,
  reconcileSnapshotChatMessages,
  sanitizeComposerPlainText,
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

  it('preserves resumedAfterApproval on failed tool results after message normalization', () => {
    const messages = normalizeChatMessages([
      {
        id: 'assistant-resume',
        role: 'assistant',
        createdAt: 1,
        content: [
          {
            type: 'tool_call',
            toolCallId: 'call-resume-1',
            toolName: 'bash',
            input: { command: 'find . | head -20' },
          },
        ],
      },
      {
        id: 'tool-resume',
        role: 'tool',
        createdAt: 2,
        content: [
          {
            type: 'tool_result',
            toolCallId: 'call-resume-1',
            toolName: 'bash',
            output: {
              stderr:
                'bash command cannot contain shell chaining, piping, or redirection operators',
            },
            isError: true,
            resumedAfterApproval: true,
          },
        ],
      },
    ]);

    const assistantTrace = parseAssistantTraceContent(messages[0]?.content ?? '');
    expect(assistantTrace?.toolCalls).toEqual([
      {
        toolCallId: 'call-resume-1',
        toolName: 'bash',
        input: { command: 'find . | head -20' },
        output: {
          stderr: 'bash command cannot contain shell chaining, piping, or redirection operators',
        },
        isError: true,
        resumedAfterApproval: true,
        status: 'failed',
      },
    ]);
  });

  it('clears pending permission state after a later approved tool result arrives', () => {
    const messages = normalizeChatMessages([
      {
        id: 'assistant-perm-complete',
        role: 'assistant',
        createdAt: 1,
        content: [
          {
            type: 'tool_call',
            toolCallId: 'call-perm-complete-1',
            toolName: 'bash',
            input: { command: 'pwd' },
          },
        ],
      },
      {
        id: 'tool-perm-pending',
        role: 'tool',
        createdAt: 2,
        content: [
          {
            type: 'tool_result',
            toolCallId: 'call-perm-complete-1',
            toolName: 'bash',
            output: 'waiting for approval',
            isError: false,
            pendingPermissionRequestId: 'perm-complete-1',
          },
        ],
      },
      {
        id: 'tool-perm-final',
        role: 'tool',
        createdAt: 3,
        content: [
          {
            type: 'tool_result',
            toolCallId: 'call-perm-complete-1',
            toolName: 'bash',
            output: '/home/await/project/OpenAWork',
            isError: false,
            resumedAfterApproval: true,
          },
        ],
      },
    ]);

    const assistantTrace = parseAssistantTraceContent(messages[0]?.content ?? '');
    expect(assistantTrace?.toolCalls).toEqual([
      {
        toolCallId: 'call-perm-complete-1',
        toolName: 'bash',
        input: { command: 'pwd' },
        output: '/home/await/project/OpenAWork',
        isError: false,
        resumedAfterApproval: true,
        status: 'completed',
      },
    ]);
  });

  it('merges final tool results back into persisted assistant_trace messages', () => {
    const messages = normalizeChatMessages([
      {
        id: 'assistant-trace-paused',
        role: 'assistant',
        createdAt: 1,
        content: JSON.stringify({
          type: 'assistant_trace',
          payload: {
            text: '',
            toolCalls: [
              {
                toolCallId: 'call-assistant-trace-1',
                toolName: 'bash',
                input: { command: 'pwd' },
                output: 'waiting for approval',
                isError: false,
                pendingPermissionRequestId: 'perm-assistant-trace-1',
                status: 'paused',
              },
            ],
          },
        }),
      },
      {
        id: 'tool-assistant-trace-final',
        role: 'tool',
        createdAt: 2,
        content: [
          {
            type: 'tool_result',
            toolCallId: 'call-assistant-trace-1',
            toolName: 'bash',
            output: '/home/await/project/OpenAWork',
            isError: false,
            resumedAfterApproval: true,
          },
        ],
      },
    ]);

    expect(messages).toHaveLength(1);
    const assistantTrace = parseAssistantTraceContent(messages[0]?.content ?? '');
    expect(assistantTrace?.toolCalls).toEqual([
      {
        toolCallId: 'call-assistant-trace-1',
        toolName: 'bash',
        input: { command: 'pwd' },
        output: '/home/await/project/OpenAWork',
        isError: false,
        resumedAfterApproval: true,
        status: 'completed',
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

  it('updates fallback tool-result assistant messages when a later result with the same toolCallId arrives', () => {
    const messages = normalizeChatMessages([
      {
        id: 'tool-fallback-pending',
        role: 'tool',
        createdAt: 1,
        content: [
          {
            type: 'tool_result',
            toolCallId: 'call-fallback-1',
            toolName: 'bash',
            output: 'waiting for approval',
            isError: false,
            pendingPermissionRequestId: 'perm-fallback-1',
          },
        ],
      },
      {
        id: 'tool-fallback-final',
        role: 'tool',
        createdAt: 2,
        content: [
          {
            type: 'tool_result',
            toolCallId: 'call-fallback-1',
            toolName: 'bash',
            output: '/home/await/project/OpenAWork',
            isError: false,
            resumedAfterApproval: true,
          },
        ],
      },
    ]);

    expect(messages).toHaveLength(1);
    const assistantTrace = parseAssistantTraceContent(messages[0]?.content ?? '');
    expect(assistantTrace?.toolCalls).toEqual([
      {
        toolCallId: 'call-fallback-1',
        toolName: 'bash',
        input: {},
        output: '/home/await/project/OpenAWork',
        isError: false,
        resumedAfterApproval: true,
        status: 'completed',
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
摘要：2 项主待办

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
  "title": "2 main todos",
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
        title: '2 main todos',
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

  it('recovers copied temporary todo cards with lane-aware titles', () => {
    const copiedText = `工具：subtodowrite
类型：TOOL
状态：完成
摘要：1 项临时待办

输入
{
  "todos": [
    {
      "content": "Record a follow-up for the temporary lane",
      "priority": "low",
      "status": "pending"
    }
  ]
}

输出
{
  "title": "1 temporary todo",
  "output": "[]",
  "metadata": {
    "todos": [
      {
        "content": "Record a follow-up for the temporary lane",
        "status": "pending",
        "priority": "low"
      }
    ]
  }
}`;

    expect(parseCopiedToolCardContent(copiedText)).toMatchObject({
      toolName: 'subtodowrite',
      kind: 'tool',
      status: 'completed',
      input: {
        todos: [
          {
            content: 'Record a follow-up for the temporary lane',
            priority: 'low',
            status: 'pending',
          },
        ],
      },
      output: {
        title: '1 temporary todo',
      },
    });
  });

  it('recovers copied todo cards when the output title is localized in chinese', () => {
    const copiedText = `工具：todowrite
类型：TOOL
状态：完成
摘要：1 项主待办

输入
{
  "todos": [
    {
      "content": "整理主计划",
      "priority": "high",
      "status": "in_progress"
    }
  ]
}

输出
{
  "title": "1 项主待办",
  "output": "[]",
  "metadata": {
    "todos": [
      {
        "content": "整理主计划",
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
            content: '整理主计划',
            priority: 'high',
            status: 'in_progress',
          },
        ],
      },
      output: {
        title: '1 项主待办',
      },
    });
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

  it('preserves approval-resume semantics when recovering copied tool card text', () => {
    const copiedText = `工具：bash
类型：TOOL
状态：恢复后失败
摘要：find . | head -20
恢复：审批已通过后继续执行

输入
{
  "command": "find . | head -20"
}

错误输出
{
  "stderr": "bash command cannot contain shell chaining, piping, or redirection operators"
}`;

    expect(parseCopiedToolCardContent(copiedText)).toMatchObject({
      toolName: 'bash',
      status: 'failed',
      resumedAfterApproval: true,
      isError: true,
    });
  });

  it('preserves approval-resume semantics from legacy tool_call payloads', () => {
    const messages = normalizeChatMessages([
      {
        id: 'assistant-legacy-resume',
        role: 'assistant',
        createdAt: 1,
        content: JSON.stringify({
          type: 'tool_call',
          payload: {
            toolCallId: 'legacy-call-1',
            toolName: 'bash',
            input: { command: 'find . | head -20' },
            output: {
              stderr:
                'bash command cannot contain shell chaining, piping, or redirection operators',
            },
            isError: true,
            resumedAfterApproval: true,
            status: 'failed',
          },
        }),
      },
    ]);

    const assistantTrace = parseAssistantTraceContent(messages[0]?.content ?? '');
    expect(assistantTrace?.toolCalls[0]).toMatchObject({
      toolCallId: 'legacy-call-1',
      toolName: 'bash',
      resumedAfterApproval: true,
      status: 'failed',
    });
  });

  it('removes resolved pending permission tool cards from local assistant messages', () => {
    const updated = clearResolvedPendingPermissionFromMessage(
      {
        id: 'assistant-local-perm',
        role: 'assistant',
        content: JSON.stringify({
          type: 'assistant_trace',
          payload: {
            text: '',
            toolCalls: [
              {
                toolCallId: 'call-local-perm-1',
                toolName: 'bash',
                input: { command: 'pwd' },
                output: 'waiting for approval',
                isError: false,
                pendingPermissionRequestId: 'perm-local-1',
                status: 'paused',
              },
            ],
          },
        }),
        createdAt: 1,
        status: 'completed',
        toolCallCount: 1,
      },
      'perm-local-1',
    );

    expect(updated).toBeNull();
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

describe('sanitizeComposerPlainText', () => {
  it('strips terminal bracketed-paste markers and pasted host prefixes', () => {
    expect(sanitizeComposerPlainText('\u001b[200~[Pasted ~4 会话已压缩\u001b[201~')).toBe(
      '会话已压缩',
    );
  });

  it('keeps normal user text unchanged', () => {
    expect(sanitizeComposerPlainText('请保留 [Pasted] 这个词作为正文示例')).toBe(
      '请保留 [Pasted] 这个词作为正文示例',
    );
  });
});
