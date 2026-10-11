import { describe, expect, it, vi } from 'vitest';
import type { StoredToolResult } from '../../message/message-v2-adapter.js';
import type * as MessageV2Adapter from '../../message/message-v2-adapter.js';

const mocks = vi.hoisted(() => ({
  getLatestReferencedToolResultMock: vi.fn((): StoredToolResult | null => null),
  getSessionToolResultByCallIdMock: vi.fn((): StoredToolResult | null => null),
  getSessionToolResultByReferenceMock: vi.fn((): StoredToolResult | null => null),
  sqliteAllMock: vi.fn(() => []),
  sqliteGetMock: vi.fn((query: string) => {
    if (query.includes('SELECT user_id FROM sessions')) {
      return { user_id: 'user-1' };
    }
    if (query.includes('SELECT metadata_json')) {
      return { metadata_json: '{}' };
    }
    return undefined;
  }),
  sqliteRunMock: vi.fn(),
}));

vi.mock('../../infra/db.js', () => ({
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_ROOT: '/home/await/project/OpenAWork',
  WORKSPACE_ROOTS: ['/home/await/project/OpenAWork'],
  sqliteAll: mocks.sqliteAllMock,
  sqliteGet: mocks.sqliteGetMock,
  sqliteRun: mocks.sqliteRunMock,
}));

vi.mock('../../message/message-v2-adapter.js', async () => {
  const actual = await vi.importActual<typeof MessageV2Adapter>(
    '../../message/message-v2-adapter.js',
  );
  return {
    ...actual,
    getLatestReferencedToolResult: mocks.getLatestReferencedToolResultMock,
    getSessionToolResultByCallId: mocks.getSessionToolResultByCallIdMock,
    getSessionToolResultByReference: mocks.getSessionToolResultByReferenceMock,
  };
});

import { createDefaultSandbox } from '../../tools/tool-sandbox.js';

describe('tool-sandbox read_tool_output', () => {
  it('拒绝读取不属于当前执行用户的会话工具结果', async () => {
    const sandbox = createDefaultSandbox();
    const result = await sandbox.execute(
      {
        toolCallId: 'call-read-cross-user',
        toolName: 'read_tool_output',
        rawInput: { toolCallId: 'call-secret' },
      },
      new AbortController().signal,
      'session-1',
      { userId: 'other-user' },
    );
    expect(result.isError).toBe(true);
    expect(mocks.getSessionToolResultByCallIdMock).not.toHaveBeenCalled();
  });

  it('prefers an explicit toolCallId lookup over latest-reference fallback', async () => {
    mocks.getSessionToolResultByCallIdMock.mockReturnValueOnce({
      toolCallId: 'call-explicit-1',
      toolName: 'bash',
      output: 'alpha\nbeta',
      isError: false,
    });

    const sandbox = createDefaultSandbox();
    const result = await sandbox.execute(
      {
        toolCallId: 'call-read-output-explicit',
        toolName: 'read_tool_output',
        rawInput: { toolCallId: 'call-explicit-1' },
      },
      new AbortController().signal,
      'session-1',
      {
        clientRequestId: 'req-read-output-explicit',
        nextRound: 1,
        requestData: { clientRequestId: 'req-read-output-explicit' },
      },
    );

    expect(mocks.getSessionToolResultByCallIdMock).toHaveBeenCalledWith({
      sessionId: 'session-1',
      userId: 'user-1',
      toolCallId: 'call-explicit-1',
    });
    expect(mocks.getLatestReferencedToolResultMock).not.toHaveBeenCalled();
    expect(result.isError).toBe(false);
    expect(result.output).toMatchObject({
      toolCallId: 'call-explicit-1',
      fullOutputPreserved: true,
      outputType: 'string',
      output: 'alpha\nbeta',
      totalLines: 2,
      selection: {
        mode: 'full',
        lineStart: 1,
        lineCount: 2,
      },
    });
  });

  it('returns actionable guidance when latest referenced output is unavailable', async () => {
    const sandbox = createDefaultSandbox();
    const result = await sandbox.execute(
      {
        toolCallId: 'call-read-output-1',
        toolName: 'read_tool_output',
        rawInput: { useLatestReferenced: true },
      },
      new AbortController().signal,
      'session-1',
      {
        clientRequestId: 'req-read-output-1',
        nextRound: 1,
        requestData: { clientRequestId: 'req-read-output-1' },
      },
    );

    expect(result.isError).toBe(true);
    expect(result.output).toBe(
      'No large referenced tool result was found in the current session. If the current session history already contains a toolCallId, call read_tool_output with that toolCallId instead of useLatestReferenced=true.',
    );
  });

  it('仅传选择参数（续读意图）时回退到最近一次被引用的输出', async () => {
    // 回归背景：模型续读上一页时只给分页参数，旧 schema 的 superRefine 直接判
    // 「toolCallId 和 useLatestReferenced 至少提供一个」，把合法续读打成参数错误。
    mocks.getLatestReferencedToolResultMock.mockReturnValueOnce({
      toolCallId: 'call-large-1',
      toolName: 'bash',
      output: 'line1\nline2\nline3\nline4',
      isError: false,
    });

    const sandbox = createDefaultSandbox();
    const result = await sandbox.execute(
      {
        toolCallId: 'call-read-continue',
        toolName: 'read_tool_output',
        rawInput: { lineStart: 3, lineCount: 2 },
      },
      new AbortController().signal,
      'session-1',
    );

    expect(result.isError).toBe(false);
    expect(mocks.getLatestReferencedToolResultMock).toHaveBeenCalledWith({
      sessionId: 'session-1',
      userId: 'user-1',
    });
    expect(result.output).toMatchObject({
      toolCallId: 'call-large-1',
      output: 'line3\nline4',
      totalLines: 4,
    });
    // 必须告诉模型实际解析到了哪个 toolCallId，否则它无法确认自己在读哪份输出。
    expect(JSON.stringify(result.output)).toContain('call-large-1');
    // 续读 note 应点明「这次解析到了哪个输出精确定位」，而不是像旧文案那样
    // 暗示「只改 lineStart 就能续读」——那正是模型只传选择参数不带引用的诱因。
    const note = (result.output as { note?: string }).note ?? '';
    // 回退场景下 handler 会给 note 追加「已自动解析为最近一个被引用的大输出：
    // {toolCallId}」的前缀，模型据此能确知在读哪份输出。
    expect(note).toContain('call-large-1');
    // 旧的续读措辞（仅改 lineStart 就能续读）不应再出现，避免误导模型下次
    // 只传选择参数不带引用。
    expect(note).not.toContain('可继续增加');
  });

  it('仅传 itemStart / itemCount 时同样回退到最近引用', async () => {
    mocks.getLatestReferencedToolResultMock.mockReturnValueOnce({
      toolCallId: 'call-array-1',
      toolName: 'websearch',
      output: [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }],
      isError: false,
    });

    const sandbox = createDefaultSandbox();
    const result = await sandbox.execute(
      {
        toolCallId: 'call-read-items',
        toolName: 'read_tool_output',
        rawInput: { itemStart: 2, itemCount: 2 },
      },
      new AbortController().signal,
      'session-1',
    );

    expect(result.isError).toBe(false);
    expect(result.output).toMatchObject({
      toolCallId: 'call-array-1',
      totalItems: 4,
      output: [{ a: 3 }, { a: 4 }],
    });
  });

  it('无引用且无可回退记录时，返回可操作的中文指引', async () => {
    const sandbox = createDefaultSandbox();
    const result = await sandbox.execute(
      {
        toolCallId: 'call-read-fallback-miss',
        toolName: 'read_tool_output',
        rawInput: { charCount: 8000 },
      },
      new AbortController().signal,
      'session-1',
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain('已回退到「最近一次被引用的大输出」');
    expect(result.output).toContain('toolCallRef');
  });

  it('显式传 toolCallId 时仍优先精确查找，不走最近引用回退', async () => {
    // 该 mock 是文件级共享的，先清零历史调用再断言「本次未走回退」。
    mocks.getLatestReferencedToolResultMock.mockClear();
    mocks.getSessionToolResultByCallIdMock.mockReturnValueOnce({
      toolCallId: 'call-explicit-2',
      toolName: 'bash',
      output: 'exact',
      isError: false,
    });

    const sandbox = createDefaultSandbox();
    const result = await sandbox.execute(
      {
        toolCallId: 'call-read-explicit-priority',
        toolName: 'read_tool_output',
        rawInput: { toolCallId: 'call-explicit-2', lineStart: 1, lineCount: 10 },
      },
      new AbortController().signal,
      'session-1',
    );

    expect(result.isError).toBe(false);
    expect(mocks.getLatestReferencedToolResultMock).not.toHaveBeenCalled();
  });

  it('通过稳定 toolCallRef 精确读取超长调用 ID 的结果', async () => {
    const toolCallRef = 'a'.repeat(64);
    mocks.getSessionToolResultByReferenceMock.mockReturnValueOnce({
      toolCallId: 'x'.repeat(10_000),
      toolName: 'mcp_call',
      output: '精确结果',
      isError: false,
    });
    const sandbox = createDefaultSandbox();

    const result = await sandbox.execute(
      {
        toolCallId: 'call-read-ref',
        toolName: 'read_tool_output',
        rawInput: { toolCallRef },
      },
      new AbortController().signal,
      'session-1',
    );

    expect(mocks.getSessionToolResultByReferenceMock).toHaveBeenCalledWith({
      sessionId: 'session-1',
      userId: 'user-1',
      toolCallRef,
    });
    expect(result.isError).toBe(false);
    expect(result.output).toMatchObject({
      output: '精确结果',
      toolCallId: toolCallRef,
      toolCallRef,
    });
  });
});
