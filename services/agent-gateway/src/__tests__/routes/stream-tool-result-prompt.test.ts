import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ToolCallRequest } from '@openAwork/agent-core';
import type * as DbModule from '../../infra/db.js';
import type * as StreamModule from '../../routes/stream.js';
import type * as ToolSandboxModule from '../../tools/tool-sandbox.js';

vi.mock('../../tools/tool-sandbox.js', async (importOriginal) => ({
  ...(await importOriginal<typeof ToolSandboxModule>()),
  createDefaultSandbox: () => ({
    execute: async (request: ToolCallRequest) => ({
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: { output: '已找到目标文件' },
      isError: false,
      durationMs: 0,
    }),
  }),
}));

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let db: typeof DbModule;
let stream: typeof StreamModule;
const USER_ID = 'tool-result-prompt-user';
const SESSION_ID = 'tool-result-prompt-session';

beforeAll(async () => {
  db = await import('../../infra/db.js');
  await db.connectDb();
  await db.migrate();
  stream = await import('../../routes/stream.js');
  db.sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'tool-result-prompt@example.com',
  ]);
  db.sqliteRun('INSERT INTO sessions (id, user_id) VALUES (?, ?)', [SESSION_ID, USER_ID]);
}, 60000);

afterAll(async () => {
  await db?.closeDb();
});

describe('executeToolCalls 的工具结果', () => {
  it('Sisyphus 直接搜索后保留原结果，不追加委派提示', async () => {
    const writeChunk = vi.fn();
    await stream.executeToolCalls({
      agentId: 'sisyphus',
      clientRequestId: 'tool-result-prompt-turn',
      enabledToolNames: new Set(['grep']),
      eventSequence: { value: 0 },
      runId: 'tool-result-prompt-run',
      signal: new AbortController().signal,
      sessionContext: { metadataJson: '{}' },
      sessionId: SESSION_ID,
      state: {
        toolCalls: new Map([['search', { toolName: 'grep', inputText: '{"pattern":"target"}' }]]),
      },
      userId: USER_ID,
      writeChunk,
    });

    expect(writeChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tool_result',
        toolCallId: 'search',
        output: { output: '已找到目标文件' },
      }),
    );
  });
});
