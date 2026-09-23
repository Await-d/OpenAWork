import { describe, expect, it } from 'vitest';
import type { Message } from '@openAwork/shared';
import { buildCallOmoAgentSyncOutput } from '../../tools/call-omo-agent-output.js';

function assistantMessage(id: string, text: string): Message {
  return {
    id,
    role: 'assistant',
    content: [{ type: 'text', text }],
    createdAt: Date.now(),
  };
}

function assistantUiEventMessage(id: string): Message {
  return {
    id,
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: JSON.stringify({ type: 'assistant_event', source: 'openawork_internal' }),
      },
    ],
    createdAt: Date.now(),
  };
}

describe('buildCallOmoAgentSyncOutput', () => {
  it('只取最后一条有文本的 assistant 消息（对齐参考库 SubagentCompletion.text）', () => {
    const output = buildCallOmoAgentSyncOutput({
      messages: [
        assistantMessage('m1', '过程性说明：先读文件。'),
        assistantMessage('m2', '最终结论：一切正常。'),
      ],
      sessionId: 'sess-child',
    });

    expect(output).toContain(
      '<subagent sessionID="sess-child" state="completed">\n最终结论：一切正常。\n</subagent>',
    );
    expect(output).not.toContain('过程性说明：先读文件。');
    expect(output).toContain('task_id: sess-child');
  });

  it('跳过整条都是 UI 事件的 assistant 消息', () => {
    const output = buildCallOmoAgentSyncOutput({
      messages: [assistantMessage('m1', '最终结论。'), assistantUiEventMessage('m2')],
      sessionId: 'sess-child',
    });

    expect(output).toContain('最终结论。');
    expect(output).not.toContain('assistant_event');
  });

  it('没有可用文本时回退到 fallbackText（错误时带 Error 前缀）', () => {
    const output = buildCallOmoAgentSyncOutput({
      fallbackText: '子代理无文本输出',
      messages: [],
      sessionId: 'sess-child',
    });
    expect(output).toContain(
      '<subagent sessionID="sess-child" state="completed">\n子代理无文本输出\n</subagent>',
    );

    const errorOutput = buildCallOmoAgentSyncOutput({
      fallbackText: 'boom',
      isError: true,
      messages: [],
      sessionId: 'sess-child',
    });
    expect(errorOutput).toContain(
      '<subagent sessionID="sess-child" state="error">\nError: boom\n</subagent>',
    );
  });
});
