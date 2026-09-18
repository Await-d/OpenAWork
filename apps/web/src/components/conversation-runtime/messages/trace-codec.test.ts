/**
 * trace-codec 是持久化 assistant_trace JSON ⇄ 结构化 parts 的双向编解码，
 * 外加 live parts 与快照 parts 的按 ID 协调。support.test.ts 覆盖的是
 * `partsFromOrderedAssistantContent` 的端到端路径；这里补齐本模块导出面的
 * 直接契约：reasoning 清洗、往返一致性、status/审批归一化，以及
 * `reconcilePartsById` 的快照分歧分支。
 */
import { describe, expect, it } from 'vitest';
import type { AssistantTracePayload } from '@openAwork/shared';
import type { ChatMessage, ChatMessagePart, ChatToolPart } from './message-model.js';
import {
  contentFromParts,
  createAssistantTraceContent,
  parseAssistantTraceContent,
  partsFromAssistantTrace,
  partsFromOrderedAssistantContent,
  readAssistantTracePayload,
  readAssistantTracePayloadFromParts,
  reconcilePartsById,
} from './trace-codec.js';

describe('createAssistantTraceContent', () => {
  it('清洗 reasoningBlocks：剥离 [REDACTED]、trim 并丢弃空块', () => {
    const content = createAssistantTraceContent({
      text: 'answer',
      toolCalls: [],
      reasoningBlocks: ['  [REDACTED]secret  ', '   ', 'second'],
    });

    expect(JSON.parse(content)).toEqual({
      type: 'assistant_trace',
      payload: { reasoningBlocks: ['secret', 'second'], text: 'answer', toolCalls: [] },
    });
  });

  it('没有有效 reasoningBlocks 时省略该键', () => {
    const content = createAssistantTraceContent({ text: 't', toolCalls: [] });

    expect(JSON.parse(content)).toEqual({
      type: 'assistant_trace',
      payload: { text: 't', toolCalls: [] },
    });
  });
});

describe('parseAssistantTraceContent', () => {
  it('解析 text / reasoningBlocks（含 timings）/ toolCalls', () => {
    const content = JSON.stringify({
      type: 'assistant_trace',
      payload: {
        text: '正文',
        reasoningBlocks: ['思考1', '思考2'],
        reasoningBlocksTimings: [{ startedAt: 10, endedAt: 20 }, {}],
        toolCalls: [
          {
            toolCallId: 't1',
            toolName: 'read',
            input: { path: 'a' },
            output: 'ok',
            status: 'completed',
          },
        ],
      },
    });

    const trace = parseAssistantTraceContent(content);
    expect(trace?.text).toBe('正文');
    expect(trace?.reasoningBlocks).toEqual(['思考1', '思考2']);
    expect(trace?.reasoningBlocksTimings).toEqual([{ startedAt: 10, endedAt: 20 }, {}]);
    expect(trace?.toolCalls[0]).toMatchObject({
      toolCallId: 't1',
      toolName: 'read',
      output: 'ok',
      status: 'completed',
    });
  });

  it('非 assistant_trace / 畸形 JSON 返回 null', () => {
    expect(parseAssistantTraceContent('')).toBeNull();
    expect(parseAssistantTraceContent('not json')).toBeNull();
    expect(
      parseAssistantTraceContent(JSON.stringify({ type: 'assistant_event', payload: {} })),
    ).toBeNull();
  });

  it('status 归一化：paused+isError → failed，paused+resumedAfterApproval → completed', () => {
    const content = JSON.stringify({
      type: 'assistant_trace',
      payload: {
        text: '',
        toolCalls: [
          { toolName: 'a', input: {}, status: 'paused', isError: true },
          { toolName: 'b', input: {}, status: 'paused', resumedAfterApproval: true },
          { toolName: 'c', input: {}, status: 'paused' },
        ],
      },
    });

    const trace = parseAssistantTraceContent(content);
    expect(trace?.toolCalls.map((call) => call.status)).toEqual(['failed', 'completed', 'paused']);
  });

  it('活跃的 pendingPermissionRequestId 把 running 提升为 paused，非活跃时丢弃该 id', () => {
    const content = JSON.stringify({
      type: 'assistant_trace',
      payload: {
        text: '',
        toolCalls: [
          { toolName: 'a', input: {}, status: 'running', pendingPermissionRequestId: 'perm-1' },
          { toolName: 'b', input: {}, status: 'completed', pendingPermissionRequestId: 'perm-2' },
        ],
      },
    });

    const trace = parseAssistantTraceContent(content);
    expect(trace?.toolCalls[0]).toMatchObject({
      status: 'paused',
      pendingPermissionRequestId: 'perm-1',
    });
    expect(trace?.toolCalls[1]?.pendingPermissionRequestId).toBeUndefined();
    expect(trace?.toolCalls[1]?.status).toBe('completed');
  });

  it('observability 与 fileDiffs 通过注入的解析器投影', () => {
    const content = JSON.stringify({
      type: 'assistant_trace',
      payload: {
        text: '',
        toolCalls: [
          {
            toolCallId: 't1',
            toolName: 'edit',
            input: {},
            observability: { presentedToolName: 'Edit File', canonicalToolName: 'edit_file' },
            fileDiffs: [{ file: 'a.ts', before: '', after: 'x', additions: 1, deletions: 0 }],
          },
        ],
      },
    });

    const trace = parseAssistantTraceContent(content);
    expect(trace?.toolCalls[0]?.observability).toStrictEqual({
      presentedToolName: 'Edit File',
      canonicalToolName: 'edit_file',
      adapterVersion: undefined,
    });
    expect(trace?.toolCalls[0]?.fileDiffs?.[0]?.file).toBe('a.ts');
  });
});

describe('partsFromAssistantTrace', () => {
  it('按 reasoning → text → tool 顺序产出确定性 ID，空 reasoning 被跳过但保留原索引', () => {
    const trace: AssistantTracePayload = {
      text: '正文',
      reasoningBlocks: ['', '思考'],
      reasoningBlocksTimings: [{}, { startedAt: 5 }],
      toolCalls: [
        { toolCallId: 'tool-1', toolName: 'read', input: { path: 'a' }, status: 'completed' },
        { toolName: 'no-id', input: {} },
      ],
    };

    const parts = partsFromAssistantTrace('msg-1', trace);
    expect(parts.map((part) => part.id)).toEqual([
      'msg-1:reasoning:1',
      'msg-1:text',
      'tool-1',
      'msg-1:tool:3',
    ]);
    expect(parts[0]).toMatchObject({ type: 'reasoning', text: '思考', startedAt: 5 });
    expect(parts[1]).toEqual({ id: 'msg-1:text', type: 'text', text: '正文' });
  });

  it('空 text 也保留 text part（与 ordered-content 的丢弃策略不同）', () => {
    const parts = partsFromAssistantTrace('msg-1', { text: '', toolCalls: [] });

    expect(parts).toEqual([{ id: 'msg-1:text', type: 'text', text: '' }]);
  });
});

describe('contentFromParts / readAssistantTracePayload 往返', () => {
  const parts: ChatMessagePart[] = [
    { id: 'm1:reasoning:0', type: 'reasoning', text: '思考', startedAt: 10, endedAt: 20 },
    { id: 'm1:text', type: 'text', text: '正文' },
    {
      id: 'tool-1',
      type: 'tool',
      toolCallId: 'tool-1',
      toolName: 'read',
      input: { path: 'a' },
      status: 'completed',
      output: 'ok',
    },
  ];

  it('parts → content → readAssistantTracePayload 保持语义', () => {
    const content = contentFromParts(parts);
    const trace = readAssistantTracePayload({ role: 'assistant', content });

    expect(trace?.text).toBe('正文');
    expect(trace?.reasoningBlocks).toEqual(['思考']);
    expect(trace?.reasoningBlocksTimings).toEqual([{ startedAt: 10, endedAt: 20 }]);
    expect(trace?.toolCalls[0]).toMatchObject({
      toolCallId: 'tool-1',
      toolName: 'read',
      output: 'ok',
      status: 'completed',
    });
  });

  it('parts → payload → parts 的 ID 保持稳定', () => {
    const trace = readAssistantTracePayloadFromParts(parts);

    expect(partsFromAssistantTrace('m1', trace).map((part) => part.id)).toEqual([
      'm1:reasoning:0',
      'm1:text',
      'tool-1',
    ]);
  });

  it('readAssistantTracePayloadFromParts 忽略 event part', () => {
    const withEvent: ChatMessagePart[] = [
      ...parts,
      {
        id: 'evt',
        type: 'event',
        payload: { kind: 'audit', message: 'm', status: 'success', title: 't' },
      },
    ];

    expect(readAssistantTracePayloadFromParts(withEvent).text).toBe('正文');
  });

  it('user 消息永远返回 null', () => {
    const content = contentFromParts(parts);

    expect(readAssistantTracePayload({ role: 'user', content })).toBeNull();
  });

  it('parts 优先于 content：content 非法 JSON 也能从 parts 读回', () => {
    const message: ChatMessage = { id: 'm1', role: 'assistant', content: '{', parts };

    expect(readAssistantTracePayload(message)?.text).toBe('正文');
  });

  it('parts 只有 event 时回退解析 content', () => {
    const content = contentFromParts(parts);
    const message: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content,
      parts: [
        {
          id: 'evt',
          type: 'event',
          payload: { kind: 'audit', message: 'm', status: 'success', title: 't' },
        },
      ],
    };

    expect(readAssistantTracePayload(message)?.text).toBe('正文');
  });
});

describe('partsFromOrderedAssistantContent', () => {
  it('保持 wire 顺序并把 tool_result 合并进对应工具卡片', () => {
    const parts = partsFromOrderedAssistantContent('m1', [
      { type: 'reasoning', text: '想', startedAt: 1, endedAt: 2 },
      { type: 'text', text: 'A' },
      { type: 'tool_call', toolCallId: 'tool-1', toolName: 'read', input: { path: 'a' } },
      { type: 'tool_result', toolCallId: 'tool-1', toolName: 'read', output: 'ok', isError: false },
      { type: 'text', text: 'B' },
    ]);

    expect(parts.map((part) => part.type)).toEqual(['reasoning', 'text', 'tool', 'text']);
    expect(parts.map((part) => part.id)).toEqual([
      'm1:reasoning:0',
      'm1:text',
      'tool-1',
      'm1:text:1',
    ]);
    const tool = parts[2] as ChatToolPart;
    expect(tool).toMatchObject({ status: 'completed', output: 'ok', isError: false });
  });

  it('空 reasoning 与纯空白 text 被丢弃；无 toolCallId 的工具用位置 ID', () => {
    const parts = partsFromOrderedAssistantContent('m1', [
      { type: 'reasoning', text: '   ' },
      { type: 'text', text: '\n' },
      { type: 'tool_call', toolName: 'anon', input: {} },
    ]);

    expect(parts).toEqual([
      {
        id: 'm1:tool:0',
        type: 'tool',
        toolCallId: '',
        toolName: 'anon',
        input: {},
        status: 'running',
      },
    ]);
  });

  it('result 带活跃 pendingPermissionRequestId 时状态为 paused', () => {
    const parts = partsFromOrderedAssistantContent('m1', [
      { type: 'tool_call', toolCallId: 'tool-1', toolName: 'write', input: {} },
      {
        type: 'tool_result',
        toolCallId: 'tool-1',
        output: '需审批',
        isError: false,
        pendingPermissionRequestId: 'perm-1',
      },
    ]);

    const tool = parts[0] as ChatToolPart;
    expect(tool.status).toBe('paused');
    expect(tool.isError).toBe(false);
    expect(tool.pendingPermissionRequestId).toBe('perm-1');
  });

  it('result 的 isError=true 优先于 pendingPermissionRequestId（活跃判定直接失效）', () => {
    const parts = partsFromOrderedAssistantContent('m1', [
      { type: 'tool_call', toolCallId: 'tool-1', toolName: 'write', input: {} },
      {
        type: 'tool_result',
        toolCallId: 'tool-1',
        output: '失败',
        isError: true,
        pendingPermissionRequestId: 'perm-1',
      },
    ]);

    const tool = parts[0] as ChatToolPart;
    expect(tool.status).toBe('failed');
    expect(tool.isError).toBe(true);
    expect(tool.pendingPermissionRequestId).toBeUndefined();
  });

  it('孤儿 tool_result 不再丢失，按 wire 位置产出 tool part', () => {
    // wire 上没有前置 tool_call 的 tool_result（attach/重连后快照从工具中段
    // 开始）此前会被直接丢弃，刷新后工具输出凭空消失。现在必须留在它到达时
    // 的 wire 位置（此处夹在两段文本之间）。
    const parts = partsFromOrderedAssistantContent('m1', [
      { type: 'text', text: '前' },
      { type: 'tool_result', toolCallId: 'ghost', output: 'x', isError: false },
      { type: 'text', text: '后' },
      null,
      'junk',
      { type: 'mystery' },
    ]);

    expect(parts.map((part) => part.type)).toEqual(['text', 'tool', 'text']);
    const tool = parts[1] as ChatToolPart;
    expect(tool).toMatchObject({
      id: 'ghost',
      type: 'tool',
      toolCallId: 'ghost',
      toolName: 'tool',
      input: {},
      output: 'x',
      isError: false,
      status: 'completed',
    });
  });

  it('孤儿 tool_result 之后的同名 tool_call 原地补齐占位，不追加第二个工具段', () => {
    const parts = partsFromOrderedAssistantContent('m1', [
      { type: 'text', text: '前' },
      { type: 'tool_result', toolCallId: 'ghost', output: 'x', isError: false },
      { type: 'text', text: '后' },
      { type: 'tool_call', toolCallId: 'ghost', toolName: 'read', input: { path: 'a' } },
    ]);

    expect(parts.map((part) => part.type)).toEqual(['text', 'tool', 'text']);
    const tools = parts.filter((part): part is ChatToolPart => part.type === 'tool');
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      toolCallId: 'ghost',
      toolName: 'read',
      input: { path: 'a' },
      output: 'x',
      status: 'completed',
    });
  });
});

describe('reconcilePartsById', () => {
  const text = (id: string, value: string): ChatMessagePart => ({ id, type: 'text', text: value });
  const tool = (id: string, overrides: Partial<ChatToolPart> = {}): ChatToolPart => ({
    id,
    type: 'tool',
    toolCallId: id,
    toolName: 'read',
    input: {},
    status: 'running',
    ...overrides,
  });

  it('相同 ID 集合时保留实时顺序，仅按 ID 合并内容', () => {
    const existing = [tool('tool-a', { status: 'running' }), text('m:text', 'hello world')];
    const incoming = [
      text('m:text', 'hello'),
      tool('tool-a', { status: 'completed', output: 'ok' }),
    ];

    const merged = reconcilePartsById(existing, incoming);
    expect(merged.map((part) => part.id)).toEqual(['tool-a', 'm:text']);
    expect(merged[0]).toMatchObject({ status: 'completed', output: 'ok' });
    expect(merged[1]).toMatchObject({ text: 'hello world' });
  });

  it('快照正文是实时正文的前缀扩展时保留更完整的实时正文', () => {
    const merged = reconcilePartsById([text('m:text', '完整回答')], [text('m:text', '完整回')]);

    expect(merged[0]).toMatchObject({ text: '完整回答' });
  });

  it('快照正文更长时采用快照正文', () => {
    const merged = reconcilePartsById([text('m:text', '回答')], [text('m:text', '完整回答')]);

    expect(merged[0]).toMatchObject({ text: '完整回答' });
  });

  it('ID 命名空间完全不相交时以快照为准', () => {
    const incoming = [text('server:text', 'snapshot'), tool('server:tool')];

    const merged = reconcilePartsById([text('local:text', 'local')], incoming);

    expect(merged).toBe(incoming);
  });

  it('快照新增同 ID 分片时按实时邻居锚定插入而不是整体前置', () => {
    const merged = reconcilePartsById(
      [text('m:text', 'A'), tool('tool-live', { status: 'running' })],
      [
        text('m:text', 'A'),
        text('m:text:1', 'B'),
        tool('tool-live', { status: 'completed', output: 'ok' }),
      ],
    );

    expect(merged.map((part) => part.id)).toEqual(['m:text', 'm:text:1', 'tool-live']);
    expect(merged[1]).toMatchObject({ text: 'B' });
  });

  it('思考分片冲突时保留更完整正文并继承快照时间戳', () => {
    const merged = reconcilePartsById(
      [{ id: 'm1:reasoning:0', type: 'reasoning', text: '先分析完' }],
      [{ id: 'm1:reasoning:0', type: 'reasoning', text: '先分析', startedAt: 100, endedAt: 400 }],
    );

    expect(merged[0]).toMatchObject({ text: '先分析完', startedAt: 100, endedAt: 400 });
  });

  it('同 ID 分片类型不同时以快照为准', () => {
    const merged = reconcilePartsById(
      [{ id: 'slot', type: 'text', text: 'local' }],
      [{ id: 'slot', type: 'reasoning', text: 'snapshot' }],
    );

    expect(merged[0]).toMatchObject({ type: 'reasoning', text: 'snapshot' });
  });

  it('实时文本身份已过期（快照次序才可信）时采用快照顺序，并把实时独有分片锚回邻居旁', () => {
    // 文档场景：live 把「工具之后」停在最早文本 ID 上，snapshot 才知道
    // 真实顺序是「工具之前 → tool → 工具之后」。
    const existing = [
      text('m:text', '工具之后'),
      tool('tool-live', { status: 'running' }),
      tool('tool-fresh', { status: 'running' }),
    ];
    const incoming = [
      text('m:text', '工具之前'),
      tool('tool-live', { status: 'completed', output: 'ok' }),
      text('m:text:1', '工具之后'),
    ];

    const merged = reconcilePartsById(existing, incoming);

    expect(merged.map((part) => part.id)).toEqual([
      'm:text',
      'tool-live',
      'tool-fresh',
      'm:text:1',
    ]);
    expect(merged[0]).toMatchObject({ text: '工具之前' });
    expect(merged[2]).toMatchObject({ id: 'tool-fresh' });
  });

  it('快照为空数组时原样保留实时分片', () => {
    const existing = [text('m:text', 'A')];

    expect(reconcilePartsById(existing, [])).toEqual(existing);
  });
});
