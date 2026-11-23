import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolCallRequest, ToolCallResult } from '@openAwork/agent-core';
import type * as DbModule from '../../infra/db.js';
import type * as StreamModule from '../../routes/stream.js';
import type * as ToolSandboxModule from '../../tools/tool-sandbox.js';
import type * as MessageModule from '../../message/message-v2-adapter.js';
import { resetDoomLoopHistory } from '../../session/doom-loop-detector.js';

const { execute, recordBlocked, appendMessage } = vi.hoisted(() => ({
  execute: vi.fn<(request: ToolCallRequest) => Promise<ToolCallResult>>(),
  recordBlocked: vi.fn(),
  appendMessage: vi.fn(),
}));

vi.mock('../../tools/tool-sandbox.js', async (importOriginal) => ({
  ...(await importOriginal<typeof ToolSandboxModule>()),
  createDefaultSandbox: () => ({ execute }),
  recordBlockedToolCallsForPendingRequest: recordBlocked,
}));

vi.mock('../../message/message-v2-adapter.js', async (importOriginal) => ({
  ...(await importOriginal<typeof MessageModule>()),
  appendSessionMessageV2: appendMessage,
}));

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let db: typeof DbModule;
let stream: typeof StreamModule;
const USER_ID = 'safe-siblings-user';
const SESSION_ID = 'safe-siblings-session';

beforeAll(async () => {
  db = await import('../../infra/db.js');
  await db.connectDb();
  await db.migrate();
  stream = await import('../../routes/stream.js');
  db.sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'safe-siblings@example.com',
  ]);
  db.sqliteRun('INSERT INTO sessions (id, user_id) VALUES (?, ?)', [SESSION_ID, USER_ID]);
}, 60000);

afterAll(async () => {
  await db?.closeDb();
});

beforeEach(() => {
  vi.clearAllMocks();
  resetDoomLoopHistory(SESSION_ID);
  execute.mockImplementation(async (request) => ({
    toolCallId: request.toolCallId,
    toolName: request.toolName,
    output: request.toolCallId === 'pending' ? 'awaiting approval' : 'permission details',
    isError: false,
    durationMs: 0,
    ...(request.toolCallId === 'pending' ? { pendingPermissionRequestId: 'permission-1' } : {}),
  }));
});

async function runSibling(
  toolName: string,
  rawInput: unknown,
  metadata: Record<string, unknown> = {},
) {
  db.sqliteRun('UPDATE sessions SET metadata_json = ? WHERE id = ?', [
    JSON.stringify(metadata),
    SESSION_ID,
  ]);
  const events: unknown[] = [];
  const result = await stream.executeToolCalls({
    clientRequestId: 'safe-siblings-turn',
    enabledToolNames: new Set(['write', 'permission_get', 'tool_invoke']),
    eventSequence: { value: 0 },
    runId: 'safe-siblings-run',
    signal: new AbortController().signal,
    // 刻意保留旧快照：本轮 allowlist 已写库，不一定同步到 sessionContext。
    sessionContext: { metadataJson: '{}' },
    sessionId: SESSION_ID,
    state: {
      toolCalls: new Map([
        ['pending', { toolName: 'write', inputText: '{"path":"a.txt","content":"x"}' }],
        ['sibling', { toolName, inputText: JSON.stringify(rawInput) }],
      ]),
    },
    userId: USER_ID,
    writeChunk: (chunk) => events.push(chunk),
  });
  return { result, events };
}

describe('executeToolCalls 的待审批兄弟工具门控', () => {
  it.each(['permission_get', 'tool_invoke'])('前序待审批后仍执行 %s 查询', async (toolName) => {
    const rawInput = toolName === 'tool_invoke' ? { tool: 'permission_get', arguments: {} } : {};
    const { result, events } = await runSibling(toolName, rawInput, {
      toolInvokeAllowlist: ['permission_get'],
    });

    expect(result).toEqual({ hasPendingPermission: true, pendingToolCallIds: ['pending'] });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1]?.[0]).toMatchObject({
      toolCallId: 'sibling',
      toolName,
      rawInput,
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'tool_result', toolCallId: 'sibling' }),
      ]),
    );
    expect(recordBlocked).toHaveBeenCalledWith('permission-1', [
      expect.objectContaining({ toolCallId: 'pending' }),
    ]);
  });

  it.each([
    {
      name: '写操作',
      rawInput: { tool: 'write', arguments: { path: 'a.txt', content: 'x' } },
      metadata: { toolInvokeAllowlist: ['write'] },
    },
    { name: '缺失 allowlist', rawInput: { tool: 'permission_get', arguments: {} }, metadata: {} },
    {
      name: '不在 allowlist',
      rawInput: { tool: 'permission_get', arguments: {} },
      metadata: { toolInvokeAllowlist: ['read'] },
    },
    {
      name: '会话已禁用',
      rawInput: { tool: 'permission_get', arguments: {} },
      metadata: {
        toolInvokeAllowlist: ['permission_get'],
        source: 'channel',
        channelToolAllowlist: [],
      },
    },
    {
      name: '数组参数',
      rawInput: { tool: 'permission_get', arguments: [] },
      metadata: { toolInvokeAllowlist: ['permission_get'] },
    },
    {
      name: '空参数',
      rawInput: { tool: 'permission_get', arguments: null },
      metadata: { toolInvokeAllowlist: ['permission_get'] },
    },
    {
      name: '缺失工具名',
      rawInput: { arguments: {} },
      metadata: { toolInvokeAllowlist: ['permission_get'] },
    },
    {
      name: '嵌套调用',
      rawInput: { tool: 'tool_invoke', arguments: { tool: 'permission_get' } },
      metadata: { toolInvokeAllowlist: ['tool_invoke', 'permission_get'] },
    },
  ])('$name 的折叠调用保持阻塞', async ({ rawInput, metadata }) => {
    const { result, events } = await runSibling('tool_invoke', rawInput, metadata);
    expect(result).toEqual({
      hasPendingPermission: true,
      pendingToolCallIds: ['pending', 'sibling'],
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(recordBlocked).toHaveBeenCalledWith('permission-1', [
      expect.objectContaining({ toolCallId: 'pending' }),
      expect.objectContaining({ toolCallId: 'sibling', toolName: 'tool_invoke', rawInput }),
    ]);
    expect(events).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ toolCallId: 'sibling' })]),
    );
  });
});
