import { beforeEach, describe, expect, it, vi } from 'vitest';

function parseToolReferencePayload(value: string | null | undefined): Record<string, unknown> {
  const prefix =
    '[tool_output_reference] 完整输出已保存在会话记录中，未裁剪；为避免上下文膨胀，本轮仅向模型提供结构化引用。';
  expect(value?.startsWith(prefix)).toBe(true);
  return JSON.parse(value!.slice(prefix.length)) as Record<string, unknown>;
}

interface MockRow {
  id: string;
  session_id: string;
  user_id: string;
  seq: number;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content_json: string;
  status: 'final' | 'error';
  client_request_id: string | null;
  created_at_ms: number;
}

let rows: MockRow[] = [];

vi.mock('../db.js', () => ({
  sqliteAll: (query: string, params: Array<string>) => {
    const [sessionId, userId, ...statuses] = params;
    const filtered = rows.filter((row) => row.session_id === sessionId && row.user_id === userId);
    if (!query.includes('status IN')) {
      return filtered.sort((a, b) => a.seq - b.seq);
    }
    return filtered.filter((row) => statuses.includes(row.status)).sort((a, b) => a.seq - b.seq);
  },
  sqliteGet: (query: string, params: Array<string>) => {
    if (query.includes('COUNT(1) AS count')) {
      const [sessionId, userId] = params;
      return {
        count: rows.filter((row) => row.session_id === sessionId && row.user_id === userId).length,
      };
    }

    if (query.includes('COALESCE(MAX(seq), 0) + 1 AS next_seq')) {
      const [sessionId, userId] = params;
      const lastSeq = rows
        .filter((row) => row.session_id === sessionId && row.user_id === userId)
        .reduce((max, row) => Math.max(max, row.seq), 0);
      return { next_seq: lastSeq + 1 };
    }

    if (
      query.includes(
        'FROM session_messages WHERE session_id = ? AND user_id = ? AND client_request_id = ? AND role = ? LIMIT 1',
      )
    ) {
      const [sessionId, userId, clientRequestId, role] = params;
      return (
        rows.find(
          (row) =>
            row.session_id === sessionId &&
            row.user_id === userId &&
            row.client_request_id === clientRequestId &&
            row.role === role,
        ) ?? undefined
      );
    }

    return undefined;
  },
  sqliteRun: (query: string, params: Array<string | number | null>) => {
    if (query.startsWith('INSERT INTO session_messages')) {
      rows.push({
        id: String(params[0]),
        session_id: String(params[1]),
        user_id: String(params[2]),
        seq: Number(params[3]),
        role: params[4] as MockRow['role'],
        content_json: String(params[5]),
        status: (params[6] as MockRow['status']) ?? 'final',
        client_request_id: (params[7] as string | null) ?? null,
        created_at_ms: Number(params[8]),
      });
      return;
    }

    if (query.startsWith("UPDATE session_messages SET content_json = ?, status = 'final'")) {
      const [contentJson, id] = params;
      rows = rows.map((row) =>
        row.id === id
          ? {
              ...row,
              content_json: String(contentJson),
              status: 'final',
            }
          : row,
      );
      return;
    }

    if (
      query.startsWith(
        'DELETE FROM session_messages WHERE session_id = ? AND user_id = ? AND seq >= ?',
      )
    ) {
      const [sessionId, userId, seq] = params;
      rows = rows.filter(
        (row) =>
          !(row.session_id === sessionId && row.user_id === userId && row.seq >= Number(seq)),
      );
      return;
    }
  },
}));

describe('session message store', () => {
  beforeEach(() => {
    rows = [];
    vi.resetModules();
  });

  it('lets a final assistant message replace a prior error for the same request id', async () => {
    const { appendSessionMessage, getSessionMessageByRequestId, listSessionMessages } =
      await import('../session-message-store.js');

    appendSessionMessage({
      sessionId: 'session-1',
      userId: 'user-1',
      role: 'assistant',
      content: [{ type: 'text', text: '[错误: STREAM_ERROR] 超时' }],
      clientRequestId: 'req-1',
      status: 'error',
    });
    appendSessionMessage({
      sessionId: 'session-1',
      userId: 'user-1',
      role: 'assistant',
      content: [{ type: 'text', text: '最终成功回复' }],
      clientRequestId: 'req-1',
    });

    const stored = getSessionMessageByRequestId({
      sessionId: 'session-1',
      userId: 'user-1',
      clientRequestId: 'req-1',
      role: 'assistant',
    });

    expect(stored?.status).toBe('final');
    expect(stored?.message.content[0]).toMatchObject({ type: 'text', text: '最终成功回复' });
    expect(listSessionMessages({ sessionId: 'session-1', userId: 'user-1' })).toHaveLength(1);
  });

  it('keeps assistant tool_call paired with tool_result when truncating history', async () => {
    const { buildUpstreamConversation } = await import('../session-message-store.js');

    const conversation = buildUpstreamConversation(
      [
        {
          id: 'user-1',
          role: 'user',
          createdAt: 1,
          content: [{ type: 'text', text: '帮我查天气' }],
        },
        {
          id: 'assistant-1',
          role: 'assistant',
          createdAt: 2,
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
          createdAt: 3,
          content: [
            {
              type: 'tool_result',
              toolCallId: 'call-1',
              output: { city: '上海', weather: '晴' },
              isError: false,
            },
          ],
        },
      ],
      1,
    );

    expect(conversation).toEqual([
      {
        role: 'user',
        content: '帮我查天气',
      },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: {
              name: 'web_search',
              arguments: '{"query":"上海天气"}',
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call-1',
        content: '{"city":"上海","weather":"晴"}',
      },
    ]);
  });

  it('omits persisted assistant_event reminders from upstream conversation context', async () => {
    const { buildUpstreamConversation } = await import('../session-message-store.js');

    const conversation = buildUpstreamConversation([
      {
        id: 'user-1',
        role: 'user',
        createdAt: 1,
        content: [{ type: 'text', text: '继续处理刚才的委派结果' }],
      },
      {
        id: 'assistant-event-1',
        role: 'assistant',
        createdAt: 2,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              type: 'assistant_event',
              payload: {
                kind: 'agent',
                title: '子代理已完成 · 文档检索',
                message: '结果：检索完成\n会话：child-1',
                status: 'success',
              },
            }),
          },
        ],
      },
      {
        id: 'assistant-2',
        role: 'assistant',
        createdAt: 3,
        content: [{ type: 'text', text: '我已整理好结论。' }],
      },
    ]);

    expect(conversation).toEqual([
      {
        role: 'user',
        content: '继续处理刚才的委派结果',
      },
      {
        role: 'assistant',
        content: '我已整理好结论。',
      },
    ]);
  });

  it('keeps real assistant replies in the context window even if trailing assistant_event reminders exist', async () => {
    const { buildUpstreamConversation } = await import('../session-message-store.js');

    const conversation = buildUpstreamConversation(
      [
        {
          id: 'user-1',
          role: 'user',
          createdAt: 1,
          content: [{ type: 'text', text: '请总结子代理结果' }],
        },
        {
          id: 'assistant-1',
          role: 'assistant',
          createdAt: 2,
          content: [{ type: 'text', text: '子代理的结论已经整理完成。' }],
        },
        {
          id: 'assistant-event-1',
          role: 'assistant',
          createdAt: 3,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                type: 'assistant_event',
                payload: {
                  kind: 'agent',
                  title: '子代理已完成 · 检索',
                  message: '结果：已整理\n会话：child-1',
                  status: 'success',
                },
              }),
            },
          ],
        },
        {
          id: 'assistant-event-2',
          role: 'assistant',
          createdAt: 4,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                type: 'assistant_event',
                payload: {
                  kind: 'agent',
                  title: '子代理已完成 · 审查',
                  message: '结果：通过\n会话：child-2',
                  status: 'success',
                },
              }),
            },
          ],
        },
      ],
      1,
    );

    expect(conversation).toEqual([
      {
        role: 'user',
        content: '请总结子代理结果',
      },
      {
        role: 'assistant',
        content: '子代理的结论已经整理完成。',
      },
    ]);
  });

  it('does not strip assistant_event-looking JSON from user messages', async () => {
    const { buildUpstreamConversation } = await import('../session-message-store.js');

    const userJson = JSON.stringify({
      type: 'assistant_event',
      payload: { kind: 'agent', title: '只是原始 JSON', message: '不要过滤', status: 'success' },
    });

    const conversation = buildUpstreamConversation([
      {
        id: 'user-1',
        role: 'user',
        createdAt: 1,
        content: [{ type: 'text', text: userJson }],
      },
    ]);

    expect(conversation).toEqual([
      {
        role: 'user',
        content: userJson,
      },
    ]);
  });

  it('keeps synthetic auto-resume user summaries in upstream conversation context', async () => {
    const { buildUpstreamConversation } = await import('../session-message-store.js');

    const autoResumeSummary = [
      '以下是后台子代理已完成后自动回流到主对话的结果，请继续当前主任务并直接回复用户。',
      '子代理 1',
      '- 任务：提取结论',
      '- 代理：explore',
      '- 状态：完成',
      '- 会话：child-1',
      '- 结果：',
      '最终真实摘要',
    ].join('\n');

    const conversation = buildUpstreamConversation([
      {
        id: 'user-1',
        role: 'user',
        createdAt: 1,
        content: [{ type: 'text', text: autoResumeSummary }],
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        createdAt: 2,
        content: [{ type: 'text', text: '我已收到子代理结果，并同步回主对话。' }],
      },
    ]);

    expect(conversation).toEqual([
      {
        role: 'user',
        content: autoResumeSummary,
      },
      {
        role: 'assistant',
        content: '我已收到子代理结果，并同步回主对话。',
      },
    ]);
  });

  it('keeps the latest user message anchored even after many assistant tool rounds', async () => {
    const { buildUpstreamConversation } = await import('../session-message-store.js');

    const messages = [
      {
        id: 'user-1',
        role: 'user' as const,
        createdAt: 1,
        content: [{ type: 'text' as const, text: '继续调查这个问题' }],
      },
      ...Array.from({ length: 6 }).flatMap((_, index) => {
        const toolCallId = `call-${index + 1}`;
        return [
          {
            id: `assistant-${index + 1}`,
            role: 'assistant' as const,
            createdAt: index * 2 + 2,
            content: [
              {
                type: 'tool_call' as const,
                toolCallId,
                toolName: 'web_search',
                input: { query: `问题 ${index + 1}` },
              },
            ],
          },
          {
            id: `tool-${index + 1}`,
            role: 'tool' as const,
            createdAt: index * 2 + 3,
            content: [
              {
                type: 'tool_result' as const,
                toolCallId,
                output: { round: index + 1 },
                isError: false,
              },
            ],
          },
        ];
      }),
    ];

    const conversation = buildUpstreamConversation(messages, 12);

    expect(conversation[0]).toMatchObject({
      role: 'user',
      content: '继续调查这个问题',
    });
    expect(conversation.filter((message) => message.role === 'user')).toHaveLength(1);
    expect(conversation.filter((message) => message.role === 'tool')).toHaveLength(6);
  });

  it('round-trips pendingPermissionRequestId inside persisted tool results', async () => {
    const { appendSessionMessage, listSessionMessages } =
      await import('../session-message-store.js');

    appendSessionMessage({
      sessionId: 'session-1',
      userId: 'user-1',
      role: 'tool',
      clientRequestId: 'req-tool-1',
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
    });

    expect(listSessionMessages({ sessionId: 'session-1', userId: 'user-1' })).toEqual([
      {
        id: expect.any(String),
        role: 'tool',
        createdAt: expect.any(Number),
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
  });

  it('round-trips toolName inside persisted tool results', async () => {
    const { appendSessionMessage, listSessionMessages } =
      await import('../session-message-store.js');

    appendSessionMessage({
      sessionId: 'session-1',
      userId: 'user-1',
      role: 'tool',
      clientRequestId: 'req-tool-2',
      content: [
        {
          type: 'tool_result',
          toolCallId: 'call-2',
          toolName: 'codesearch',
          output: 'snippet',
          isError: false,
        },
      ],
    });

    expect(
      listSessionMessages({ sessionId: 'session-1', userId: 'user-1' })[0]?.content[0],
    ).toMatchObject({
      type: 'tool_result',
      toolCallId: 'call-2',
      toolName: 'codesearch',
    });
  });

  it('round-trips tool_result trace metadata from persisted messages', async () => {
    const { appendSessionMessage, listSessionMessages } =
      await import('../session-message-store.js');

    appendSessionMessage({
      sessionId: 'session-1',
      userId: 'user-1',
      role: 'tool',
      clientRequestId: 'req-tool-trace',
      content: [
        {
          type: 'tool_result',
          toolCallId: 'call-trace',
          toolName: 'write',
          clientRequestId: 'req-tool-trace',
          output: { ok: true },
          isError: false,
          fileDiffs: [
            {
              file: '/repo/a.ts',
              before: 'a',
              after: 'b',
              additions: 1,
              deletions: 1,
              status: 'modified',
              clientRequestId: 'req-tool-trace',
              requestId: 'req-tool-trace:tool:call-trace',
              toolName: 'write',
              toolCallId: 'call-trace',
              sourceKind: 'structured_tool_diff',
              guaranteeLevel: 'strong',
              backupBeforeRef: {
                backupId: 'backup-1',
                kind: 'before_write',
                storagePath: '/tmp/backup-1',
              },
              observability: {
                presentedToolName: 'Write',
                canonicalToolName: 'write',
                toolSurfaceProfile: 'openawork',
              },
            },
          ],
          observability: {
            presentedToolName: 'Write',
            canonicalToolName: 'write',
            toolSurfaceProfile: 'openawork',
          },
        },
      ],
    });

    expect(
      listSessionMessages({ sessionId: 'session-1', userId: 'user-1' })[0]?.content[0],
    ).toEqual({
      type: 'tool_result',
      toolCallId: 'call-trace',
      toolName: 'write',
      clientRequestId: 'req-tool-trace',
      output: { ok: true },
      isError: false,
      fileDiffs: [
        {
          file: '/repo/a.ts',
          before: 'a',
          after: 'b',
          additions: 1,
          deletions: 1,
          status: 'modified',
          clientRequestId: 'req-tool-trace',
          requestId: 'req-tool-trace:tool:call-trace',
          toolName: 'write',
          toolCallId: 'call-trace',
          sourceKind: 'structured_tool_diff',
          guaranteeLevel: 'strong',
          backupBeforeRef: {
            backupId: 'backup-1',
            kind: 'before_write',
            storagePath: '/tmp/backup-1',
          },
          observability: {
            presentedToolName: 'Write',
            canonicalToolName: 'write',
            toolSurfaceProfile: 'openawork',
          },
        },
      ],
      observability: {
        presentedToolName: 'Write',
        canonicalToolName: 'write',
        toolSurfaceProfile: 'openawork',
      },
    });
  });

  it('round-trips modified_files_summary content from stored assistant messages', async () => {
    const { listSessionMessages } = await import('../session-message-store.js');

    rows = [
      {
        id: 'assistant-summary',
        session_id: 'session-1',
        user_id: 'user-1',
        seq: 1,
        role: 'assistant',
        content_json: JSON.stringify([
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
                clientRequestId: 'req-summary-1',
                requestId: 'req-summary-1:tool:call-1',
                toolName: 'write',
                toolCallId: 'call-1',
                sourceKind: 'structured_tool_diff',
                guaranteeLevel: 'medium',
                observability: {
                  presentedToolName: 'Write',
                  canonicalToolName: 'write',
                  toolSurfaceProfile: 'openawork',
                },
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
        ]),
        status: 'final',
        client_request_id: 'req-summary-1',
        created_at_ms: 1,
      },
    ];

    expect(listSessionMessages({ sessionId: 'session-1', userId: 'user-1' })).toEqual([
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
                clientRequestId: 'req-summary-1',
                requestId: 'req-summary-1:tool:call-1',
                toolName: 'write',
                toolCallId: 'call-1',
                sourceKind: 'structured_tool_diff',
                guaranteeLevel: 'medium',
                observability: {
                  presentedToolName: 'Write',
                  canonicalToolName: 'write',
                  toolSurfaceProfile: 'openawork',
                },
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
        ],
      },
    ]);
  });

  it('keeps full large tool outputs in storage but sends a structured reference upstream', async () => {
    const {
      appendSessionMessage,
      buildUpstreamConversation,
      hasToolOutputReference,
      listSessionMessages,
    } = await import('../session-message-store.js');

    const largeOutput = 'line:payload\n'.repeat(2500);

    appendSessionMessage({
      sessionId: 'session-1',
      userId: 'user-1',
      role: 'user',
      content: [{ type: 'text', text: '分析这个大型输出' }],
      clientRequestId: 'req-user-1',
    });
    appendSessionMessage({
      sessionId: 'session-1',
      userId: 'user-1',
      role: 'tool',
      clientRequestId: 'req-tool-large',
      content: [
        {
          type: 'tool_result',
          toolCallId: 'call-large-1',
          output: largeOutput,
          isError: false,
        },
      ],
    });

    const stored = listSessionMessages({ sessionId: 'session-1', userId: 'user-1' });
    expect(stored[1]?.content[0]).toMatchObject({
      type: 'tool_result',
      toolCallId: 'call-large-1',
      output: largeOutput,
      isError: false,
    });

    const conversation = buildUpstreamConversation(stored);
    expect(hasToolOutputReference(conversation)).toBe(true);
    const toolMessage = conversation.find((message) => message.role === 'tool');
    expect(toolMessage?.content).toContain('[tool_output_reference]');
    const metadata = parseToolReferencePayload(toolMessage?.content);
    expect(metadata).toMatchObject({
      fullOutputPreserved: true,
      storage: 'session_message',
      retrievalTool: 'read_tool_output',
      toolCallId: 'call-large-1',
      valueType: 'string',
    });
    expect(typeof metadata['sha256']).toBe('string');
    expect(metadata['sizeBytes']).toBeGreaterThan(8 * 1024);
    expect(metadata['lineCount']).toBeGreaterThan(1);
    expect(typeof metadata['hint']).toBe('string');
    expect(toolMessage?.content).not.toContain('line:payload\nline:payload\nline:payload');
  });

  it('keeps tool output inline when UTF-8 payload is exactly 8KB', async () => {
    const { buildUpstreamConversation } = await import('../session-message-store.js');

    const exactInlineOutput = 'a'.repeat(8 * 1024);
    const conversation = buildUpstreamConversation([
      {
        id: 'user-inline',
        role: 'user',
        createdAt: 1,
        content: [{ type: 'text', text: '检查边界' }],
      },
      {
        id: 'tool-inline',
        role: 'tool',
        createdAt: 2,
        content: [
          {
            type: 'tool_result',
            toolCallId: 'call-inline',
            output: exactInlineOutput,
            isError: false,
          },
        ],
      },
    ]);

    const toolMessage = conversation.find((message) => message.role === 'tool');
    expect(Buffer.byteLength(exactInlineOutput, 'utf8')).toBe(8 * 1024);
    expect(toolMessage?.content).toBe(exactInlineOutput);
  });

  it('switches to structured references using UTF-8 byte size instead of character count', async () => {
    const { buildUpstreamConversation } = await import('../session-message-store.js');

    const multiByteOutput = '你好🙂'.repeat(900);
    expect(multiByteOutput.length).toBeLessThan(8 * 1024);
    expect(Buffer.byteLength(multiByteOutput, 'utf8')).toBeGreaterThan(8 * 1024);

    const conversation = buildUpstreamConversation([
      {
        id: 'user-utf8',
        role: 'user',
        createdAt: 1,
        content: [{ type: 'text', text: '检查 UTF-8 边界' }],
      },
      {
        id: 'tool-utf8',
        role: 'tool',
        createdAt: 2,
        content: [
          {
            type: 'tool_result',
            toolCallId: 'call-utf8',
            output: multiByteOutput,
            isError: false,
          },
        ],
      },
    ]);

    const toolMessage = conversation.find((message) => message.role === 'tool');
    const metadata = parseToolReferencePayload(toolMessage?.content);
    expect(metadata).toMatchObject({
      fullOutputPreserved: true,
      toolCallId: 'call-utf8',
      valueType: 'string',
    });
    expect(metadata['sizeBytes']).toBe(Buffer.byteLength(multiByteOutput, 'utf8'));
    expect(metadata['lineCount']).toBe(1);
  });

  it('detects when upstream conversation contains tool output references', async () => {
    const { hasToolOutputReference } = await import('../session-message-store.js');

    expect(
      hasToolOutputReference([
        { role: 'user', content: 'hello' },
        {
          role: 'tool',
          tool_call_id: 'call-1',
          content:
            '[tool_output_reference] 完整输出已保存在会话记录中，未裁剪；为避免上下文膨胀，本轮仅向模型提供结构化引用。{}',
        },
      ]),
    ).toBe(true);
    expect(hasToolOutputReference([{ role: 'user', content: 'hello' }])).toBe(false);
  });

  it('returns the latest large referenced tool result shortcut target', async () => {
    const { getLatestReferencedToolResult } = await import('../session-message-store.js');

    rows = [
      {
        id: 'tool-small',
        session_id: 'session-1',
        user_id: 'user-1',
        seq: 1,
        role: 'tool',
        content_json: JSON.stringify([
          {
            type: 'tool_result',
            toolCallId: 'call-small',
            output: 'small output',
            isError: false,
          },
        ]),
        status: 'final',
        client_request_id: 'req-small',
        created_at_ms: 1,
      },
      {
        id: 'tool-large-old',
        session_id: 'session-1',
        user_id: 'user-1',
        seq: 2,
        role: 'tool',
        content_json: JSON.stringify([
          {
            type: 'tool_result',
            toolCallId: 'call-large-old',
            output: 'x'.repeat(9000),
            isError: false,
          },
        ]),
        status: 'final',
        client_request_id: 'req-large-old',
        created_at_ms: 2,
      },
      {
        id: 'tool-large-new',
        session_id: 'session-1',
        user_id: 'user-1',
        seq: 3,
        role: 'tool',
        content_json: JSON.stringify([
          {
            type: 'tool_result',
            toolCallId: 'call-large-new',
            output: 'y'.repeat(9500),
            isError: false,
          },
        ]),
        status: 'final',
        client_request_id: 'req-large-new',
        created_at_ms: 3,
      },
    ];

    expect(
      getLatestReferencedToolResult({ sessionId: 'session-1', userId: 'user-1' }),
    ).toMatchObject({
      toolCallId: 'call-large-new',
      output: 'y'.repeat(9500),
      isError: false,
    });
  });

  it('filters request scope by exact prefix rather than SQL wildcard semantics', async () => {
    const { listSessionMessagesByRequestScope } = await import('../session-message-store.js');

    rows = [
      {
        id: 'm1',
        session_id: 'session-1',
        user_id: 'user-1',
        seq: 1,
        role: 'assistant',
        content_json: JSON.stringify([{ type: 'text', text: 'base' }]),
        status: 'final',
        client_request_id: 'req_1',
        created_at_ms: 1,
      },
      {
        id: 'm2',
        session_id: 'session-1',
        user_id: 'user-1',
        seq: 2,
        role: 'assistant',
        content_json: JSON.stringify([{ type: 'text', text: 'child' }]),
        status: 'final',
        client_request_id: 'req_1:assistant:1',
        created_at_ms: 2,
      },
      {
        id: 'm3',
        session_id: 'session-1',
        user_id: 'user-1',
        seq: 3,
        role: 'assistant',
        content_json: JSON.stringify([{ type: 'text', text: 'wrong-prefix' }]),
        status: 'final',
        client_request_id: 'reqA1',
        created_at_ms: 3,
      },
    ];

    const scoped = listSessionMessagesByRequestScope({
      sessionId: 'session-1',
      userId: 'user-1',
      clientRequestId: 'req_1',
    });

    expect(scoped.map((message) => message.id)).toEqual(['m1', 'm2']);
  });

  it('truncates messages from the target message onward', async () => {
    rows = [
      {
        id: 'user-1',
        session_id: 'session-1',
        user_id: 'user-1',
        seq: 1,
        role: 'user',
        content_json: JSON.stringify([{ type: 'text', text: '前置历史' }]),
        status: 'final',
        client_request_id: null,
        created_at_ms: 1,
      },
      {
        id: 'assistant-1',
        session_id: 'session-1',
        user_id: 'user-1',
        seq: 2,
        role: 'assistant',
        content_json: JSON.stringify([{ type: 'text', text: '第一次回答' }]),
        status: 'final',
        client_request_id: null,
        created_at_ms: 2,
      },
      {
        id: 'user-2',
        session_id: 'session-1',
        user_id: 'user-1',
        seq: 3,
        role: 'user',
        content_json: JSON.stringify([{ type: 'text', text: '后续问题' }]),
        status: 'final',
        client_request_id: null,
        created_at_ms: 3,
      },
    ];

    const { truncateSessionMessagesAfter } = await import('../session-message-store.js');
    const remaining = truncateSessionMessagesAfter({
      sessionId: 'session-1',
      userId: 'user-1',
      messageId: 'assistant-1',
      inclusive: true,
    });

    expect(remaining.map((message) => message.id)).toEqual(['user-1']);
  });
});
