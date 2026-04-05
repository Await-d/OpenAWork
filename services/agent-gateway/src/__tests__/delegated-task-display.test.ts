import { describe, expect, it } from 'vitest';
import type { Message } from '@openAwork/shared';
import {
  buildBackgroundCancelAllMessage,
  buildBackgroundTaskResultMessage,
  buildBackgroundTaskStatusMessage,
  buildTaskToolBackgroundMessage,
  buildTaskToolTerminalMessage,
  collectDelegatedSessionText,
} from '../delegated-task-display.js';

describe('delegated-task-display', () => {
  it('collects assistant and tool output while skipping assistant events', () => {
    const messages: Message[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        createdAt: 1,
        content: [{ type: 'text', text: '第一段结论' }],
      },
      {
        id: 'tool-1',
        role: 'tool',
        createdAt: 2,
        content: [
          {
            type: 'tool_result',
            toolCallId: 'call-1',
            toolName: 'grep',
            output: { result: '命中 3 条记录' },
            isError: false,
          },
        ],
      },
      {
        id: 'assistant-event-1',
        role: 'assistant',
        createdAt: 3,
        content: [
          {
            type: 'text',
            text: JSON.stringify({ source: 'openawork_internal', type: 'assistant_event' }),
          },
        ],
      },
    ];

    expect(collectDelegatedSessionText(messages)).toBe('第一段结论\n\n命中 3 条记录');
  });

  it('formats task background launch text like the reference style', () => {
    expect(
      buildTaskToolBackgroundMessage({
        agent: 'explore',
        category: 'deep',
        description: '让子代理分析代码',
        sessionId: 'ses_1',
        status: 'running',
        taskId: 'task_1',
      }),
    ).toContain('Background task launched successfully.');
  });

  it('formats task terminal text with session continuation hint', () => {
    expect(
      buildTaskToolTerminalMessage({
        agent: 'explore',
        completedAt: 3000,
        resultText: '最终结论',
        sessionId: 'ses_1',
        startedAt: 1000,
        status: 'done',
      }),
    ).toBe(
      [
        'task_id: ses_1 (for resuming to continue this task if needed)',
        '',
        '<task_result>',
        '最终结论',
        '</task_result>',
      ].join('\n'),
    );
  });

  it('formats background task result text', () => {
    expect(
      buildBackgroundTaskResultMessage({
        agent: 'explore',
        completedAt: 3000,
        description: '检索仓库',
        resultText: '找到 5 个匹配项',
        sessionId: 'ses_1',
        startedAt: 1000,
        taskId: 'task_1',
      }),
    ).toContain('Task Result');
  });

  it('formats running status text with prompt preview', () => {
    expect(
      buildBackgroundTaskStatusMessage({
        agent: 'explore',
        description: '检索仓库',
        lastMessage: '正在读取文件',
        lastMessageAt: 1000,
        prompt: '请搜索所有 task 相关实现',
        sessionId: 'ses_1',
        startedAt: 500,
        status: 'running',
        taskId: 'task_1',
      }),
    ).toContain('## Original Prompt');
  });

  it('formats batch cancel text with continue instructions', () => {
    expect(
      buildBackgroundCancelAllMessage({
        tasks: [
          {
            agent: 'explore',
            description: '检索仓库',
            requestedSkills: [],
            sessionId: 'ses_1',
            status: 'running',
            taskId: 'task_1',
          },
        ],
      }),
    ).toContain('## Continue Instructions');
  });
});
