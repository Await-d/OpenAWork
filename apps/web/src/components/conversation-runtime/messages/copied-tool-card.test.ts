/**
 * 共置测试：`copied-tool-card.ts`。
 *
 * 这个模块有两条并存的消息重建入口：
 *
 * - `parseCopiedToolCardContent` 解析"复制卡片"文本协议
 *   （`工具：/类型：/状态：/摘要：` 分段 + `输入`/`输出`/`错误输出` 正文块），
 *   主要服务于用户从别处复制回来的工具卡片；
 * - `parseLegacyToolCallContent` 解析历史持久化的 `tool_call` JSON，
 *   JSON 不合法或不是 `tool_call` 时回退到复制卡片解析。
 *
 * 两者都产出 `AssistantTraceToolCall`，随后要么独立成消息，要么由
 * `appendToolCallToAssistantMessage` 追加到上一条助手消息。这里只固定
 * 模块自身的解析/追加契约，不重复 `support.test.ts` 的集成路径。
 */
import { describe, expect, it } from 'vitest';
import {
  appendToolCallToAssistantMessage,
  parseCopiedToolCardContent,
  parseLegacyToolCallContent,
  parseToolCallInputText,
} from './copied-tool-card.js';
import type { ChatMessage } from './message-model.js';
import { createAssistantTraceContent, parseAssistantTraceContent } from './trace-codec.js';

interface CopiedCardSections {
  errorOutput?: string;
  input?: string;
  output?: string;
  resume?: string;
  status?: string;
  summary?: string;
  tool: string;
  type?: string;
}

function buildCopiedCard(sections: CopiedCardSections): string {
  const header = [
    `工具：${sections.tool}`,
    `类型：${sections.type ?? 'TOOL'}`,
    `状态：${sections.status ?? '完成'}`,
    `摘要：${sections.summary ?? '执行一次操作'}`,
  ];
  if (sections.resume !== undefined) {
    header.push(`恢复：${sections.resume}`);
  }

  let content = header.join('\n');
  if (sections.input !== undefined) {
    content += `\n\n输入\n${sections.input}`;
  }
  if (sections.output !== undefined) {
    content += `\n\n输出\n${sections.output}`;
  }
  if (sections.errorOutput !== undefined) {
    content += `\n\n错误输出\n${sections.errorOutput}`;
  }
  return content;
}

describe('parseCopiedToolCardContent', () => {
  it('解析完整卡片：工具名/类型/状态/输入/输出', () => {
    const call = parseCopiedToolCardContent(
      buildCopiedCard({
        tool: 'Bash',
        type: 'TOOL',
        status: '完成',
        input: '{"command":"npm run build"}',
        output: '{"stdout":"ok"}',
      }),
    );

    expect(call).toEqual({
      isError: false,
      input: { command: 'npm run build' },
      kind: 'tool',
      output: { stdout: 'ok' },
      status: 'completed',
      toolName: 'Bash',
    });
    expect(call).not.toHaveProperty('resumedAfterApproval');
  });

  it.each([
    ['子代理任务', 'task'],
    ['技能', 'Skill'],
    ['询问用户', 'AskUserQuestion'],
    ['代理委派', 'Agent'],
    ['进入规划模式', 'EnterPlanMode'],
    ['退出规划模式', 'ExitPlanMode'],
    ['自定义工具', '自定义工具'],
  ])('归一化中文工具名 %s → %s', (rawToolName, expectedToolName) => {
    const call = parseCopiedToolCardContent(buildCopiedCard({ tool: rawToolName }));
    expect(call?.toolName).toBe(expectedToolName);
  });

  it.each([
    ['完成', 'completed'],
    ['completed', 'completed'],
    ['失败', 'failed'],
    ['failed', 'failed'],
    ['恢复后失败', 'failed'],
    ['执行中', 'running'],
    ['running', 'running'],
    ['等待权限', 'paused'],
    ['等待处理', 'paused'],
    ['等待回答', 'paused'],
    ['等待确认', 'paused'],
    ['paused', 'paused'],
  ])('映射状态 %s → %s', (rawStatus, expectedStatus) => {
    const call = parseCopiedToolCardContent(buildCopiedCard({ tool: 'Bash', status: rawStatus }));
    expect(call?.status).toBe(expectedStatus);
  });

  it('无法识别的类型与状态被丢弃，工具名保持原样', () => {
    const call = parseCopiedToolCardContent(
      buildCopiedCard({ tool: 'Mystery', type: 'UNKNOWN', status: '未知状态' }),
    );

    expect(call?.kind).toBeUndefined();
    expect(call?.status).toBeUndefined();
    expect(call?.toolName).toBe('Mystery');
  });

  it('等待权限状态且输出为等待文案时保持 paused', () => {
    const call = parseCopiedToolCardContent(
      buildCopiedCard({
        tool: 'Bash',
        status: '等待权限',
        output: 'waiting for approval: run npm install',
      }),
    );

    expect(call?.status).toBe('paused');
    expect(call?.output).toBe('waiting for approval: run npm install');
    expect(call?.isError).toBe(false);
  });

  it('paused 状态但输出不是等待文案时降级为 failed', () => {
    const call = parseCopiedToolCardContent(
      buildCopiedCard({ tool: 'Bash', status: 'paused', output: 'boom' }),
    );

    expect(call?.status).toBe('failed');
    expect(call?.output).toBe('boom');
  });

  it('错误输出把 isError 置为 true', () => {
    const call = parseCopiedToolCardContent(
      buildCopiedCard({ tool: 'Bash', status: '完成', errorOutput: 'permission denied' }),
    );

    expect(call?.isError).toBe(true);
    expect(call?.output).toBe('permission denied');
  });

  it('非 JSON 输入回退为 { raw }，数组输出保持数组', () => {
    const call = parseCopiedToolCardContent(
      buildCopiedCard({ tool: 'Bash', input: 'plain text args', output: '[1,2,3]' }),
    );

    expect(call?.input).toEqual({ raw: 'plain text args' });
    expect(call?.output).toEqual([1, 2, 3]);
  });

  it('恢复标记为审批继续时为 true', () => {
    const call = parseCopiedToolCardContent(
      buildCopiedCard({ tool: 'Bash', status: '执行中', resume: '审批已通过后继续执行' }),
    );

    expect(call?.resumedAfterApproval).toBe(true);
    expect(call?.status).toBe('running');
  });

  it.each([
    ['不是卡片', '普通文本内容'],
    ['缺少状态行', '工具：Bash\n类型：TOOL\n摘要：执行'],
    ['缺少摘要行', '工具：Bash\n类型：TOOL\n状态：完成'],
    ['工具名为空', '工具：\n类型：TOOL\n状态：完成\n摘要：执行'],
  ])('%s 时返回 null', (_name, content) => {
    expect(parseCopiedToolCardContent(content)).toBeNull();
  });
});

describe('parseLegacyToolCallContent', () => {
  it('解析 type=tool_call 的完整 payload', () => {
    const content = JSON.stringify({
      type: 'tool_call',
      payload: {
        toolCallId: 'tc-1',
        toolName: 'Bash',
        kind: 'tool',
        input: { command: 'ls' },
        output: 'ok',
        status: 'completed',
      },
    });

    expect(parseLegacyToolCallContent(content)).toEqual({
      isError: false,
      input: { command: 'ls' },
      kind: 'tool',
      output: 'ok',
      status: 'completed',
      toolCallId: 'tc-1',
      toolName: 'Bash',
    });
  });

  it('非法 kind/status 被丢弃，缺失字段使用默认值', () => {
    const content = JSON.stringify({
      type: 'tool_call',
      payload: { kind: 'mystery', status: 'mystery' },
    });

    expect(parseLegacyToolCallContent(content)).toEqual({
      input: {},
      isError: false,
      toolName: 'tool',
    });
  });

  it('pendingPermissionRequestId 在 paused 状态下保留', () => {
    const content = JSON.stringify({
      type: 'tool_call',
      payload: {
        toolCallId: 'tc-1',
        toolName: 'Bash',
        input: {},
        output: 'waiting for approval',
        pendingPermissionRequestId: 'req-1',
        status: 'paused',
      },
    });

    const call = parseLegacyToolCallContent(content);
    expect(call?.status).toBe('paused');
    expect(call?.pendingPermissionRequestId).toBe('req-1');
  });

  it('已恢复执行的 paused 工具降级为 failed 并保留 resumedAfterApproval', () => {
    const content = JSON.stringify({
      type: 'tool_call',
      payload: {
        toolCallId: 'tc-1',
        toolName: 'Bash',
        input: {},
        output: 'done',
        status: 'paused',
        resumedAfterApproval: true,
      },
    });

    const call = parseLegacyToolCallContent(content);
    expect(call?.status).toBe('failed');
    expect(call?.resumedAfterApproval).toBe(true);
    expect(call).not.toHaveProperty('pendingPermissionRequestId');
  });

  it.each([
    ['不是 tool_call 的 JSON', JSON.stringify({ type: 'assistant_trace', payload: {} })],
    ['无法解析的文本', '完全不是 JSON'],
  ])('%s 时回退到复制卡片解析', (_name, content) => {
    expect(parseLegacyToolCallContent(content)).toBeNull();
  });

  it('非 tool_call 文本若是合法复制卡片则回退解析成功', () => {
    const card = buildCopiedCard({ tool: '技能', type: 'SKILL', status: '执行中' });
    const call = parseLegacyToolCallContent(card);

    expect(call?.toolName).toBe('Skill');
    expect(call?.kind).toBe('skill');
    expect(call?.status).toBe('running');
  });
});

describe('appendToolCallToAssistantMessage', () => {
  it('已有 trace 时追加工具调用并保留文本', () => {
    const message: ChatMessage = {
      id: 'msg-1',
      role: 'assistant',
      content: createAssistantTraceContent({
        text: '先说明一下。',
        toolCalls: [{ toolCallId: 'tc-1', toolName: 'Read', input: {} }],
      }),
      status: 'completed',
    };

    const next = appendToolCallToAssistantMessage(message, {
      toolCallId: 'tc-2',
      toolName: 'Bash',
      input: { command: 'pwd' },
      status: 'running',
    });

    const trace = parseAssistantTraceContent(next.content);
    expect(trace?.text).toBe('先说明一下。');
    expect(trace?.toolCalls.map((toolCall) => toolCall.toolCallId)).toEqual(['tc-1', 'tc-2']);
    expect(next.toolCallCount).toBe(2);
    expect(next.parts).toHaveLength(1);
    expect(next.parts?.[0]).toMatchObject({ id: 'tc-2', type: 'tool', toolName: 'Bash' });
  });

  it('无 trace 时以消息正文为文本新建 trace', () => {
    const message: ChatMessage = {
      id: 'msg-1',
      role: 'assistant',
      content: '你好，我来处理。',
      status: 'completed',
    };

    const next = appendToolCallToAssistantMessage(message, {
      toolCallId: 'tc-9',
      toolName: 'Echo',
      input: {},
    });

    const trace = parseAssistantTraceContent(next.content);
    expect(trace?.text).toBe('你好，我来处理。');
    expect(trace?.toolCalls).toHaveLength(1);
    expect(next.parts?.map((part) => part.id)).toEqual(['msg-1:text', 'tc-9']);
    expect(next.toolCallCount).toBe(1);
  });

  it('toolCallId 缺失时用消息 ID 派生分片 ID', () => {
    const message: ChatMessage = {
      id: 'msg-2',
      role: 'assistant',
      content: '继续。',
      status: 'completed',
    };

    const next = appendToolCallToAssistantMessage(message, { toolName: 'Mystery', input: {} });
    expect(next.parts?.[1]).toMatchObject({ id: 'msg-2:tool:0', toolCallId: '' });
  });

  it('递增已有的 toolCallCount', () => {
    const message: ChatMessage = {
      id: 'msg-3',
      role: 'assistant',
      content: '文本',
      toolCallCount: 5,
      status: 'completed',
    };

    const next = appendToolCallToAssistantMessage(message, { toolName: 'Echo', input: {} });
    expect(next.toolCallCount).toBe(6);
  });
});

describe('parseToolCallInputText', () => {
  it('解析 JSON 对象输入', () => {
    expect(parseToolCallInputText('{"command":"ls","flag":true}')).toEqual({
      command: 'ls',
      flag: true,
    });
  });

  it.each([
    ['JSON 数组', '[1,2]', { raw: '[1,2]' }],
    ['JSON 标量', '42', { raw: '42' }],
    ['完全非 JSON', 'some args', { raw: 'some args' }],
    ['JSON null', 'null', { raw: 'null' }],
  ])('%s 回退为 { raw }', (_name, input, expected) => {
    expect(parseToolCallInputText(input)).toEqual(expected);
  });

  it('空白输入返回空对象', () => {
    expect(parseToolCallInputText('')).toEqual({});
    expect(parseToolCallInputText('   \n\t')).toEqual({});
  });
});
