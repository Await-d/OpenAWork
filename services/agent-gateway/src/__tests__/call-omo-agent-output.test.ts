import { describe, expect, it } from 'vitest';
import type { Message } from '@openAwork/shared';
import {
  buildCallOmoAgentBackgroundOutput,
  buildCallOmoAgentSyncOutput,
  buildDelegatedChildClientRequestId,
} from '../call-omo-agent-output.js';

describe('call-omo-agent-output', () => {
  it('formats background Agent output like the reference implementation', () => {
    expect(
      buildCallOmoAgentBackgroundOutput({
        agent: 'explore',
        description: '让子代理给出结论',
        sessionId: 'ses_child_1',
        status: 'running',
        taskId: 'task_child_1',
      }),
    ).toContain('Background agent task launched successfully.');

    expect(
      buildCallOmoAgentBackgroundOutput({
        agent: 'explore',
        description: '让子代理给出结论',
        sessionId: 'ses_child_1',
        status: 'running',
        taskId: 'task_child_1',
      }),
    ).toContain('Agent: explore (subagent)');
  });

  it('aggregates assistant and tool outputs for sync Agent responses', () => {
    const messages: Message[] = [
      {
        id: 'user-1',
        role: 'user',
        createdAt: 1,
        content: [{ type: 'text', text: 'ignored' }],
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        createdAt: 2,
        content: [{ type: 'text', text: '第一段结论' }],
      },
      {
        id: 'tool-1',
        role: 'tool',
        createdAt: 3,
        content: [
          {
            type: 'tool_result',
            toolCallId: 'call-1',
            toolName: 'grep',
            output: { result: '检索命中 3 条记录' },
            isError: false,
          },
        ],
      },
      {
        id: 'assistant-event-1',
        role: 'assistant',
        createdAt: 4,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              source: 'openawork_internal',
              type: 'assistant_event',
              payload: { title: '子代理已完成' },
            }),
          },
        ],
      },
      {
        id: 'assistant-2',
        role: 'assistant',
        createdAt: 5,
        content: [{ type: 'text', text: '第二段结论' }],
      },
    ];

    expect(
      buildCallOmoAgentSyncOutput({
        messages,
        sessionId: 'ses_child_1',
      }),
    ).toBe(
      [
        'task_id: ses_child_1 (for resuming to continue this task if needed)',
        '',
        '<task_result>',
        '第一段结论',
        '',
        '第二段结论',
        '',
        '检索命中 3 条记录',
        '</task_result>',
      ].join('\n'),
    );
  });

  it('reuses the delegated child request id format for scoped message lookup', () => {
    expect(
      buildDelegatedChildClientRequestId({
        childSessionId: 'ses_child_1',
        parentClientRequestId: 'parent-req-1',
      }),
    ).toBe('task:parent-req-1:child:ses_child_1');
  });
});
