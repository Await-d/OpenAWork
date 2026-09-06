import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, connectDb, migrate, sqliteRun } from '../../infra/db.js';
import {
  appendSessionMessageV2,
  markToolPartsCompactedV2,
} from '../../message/message-v2-adapter.js';
import { listMessagesWithParts } from '../../message/message-store-v2.js';

const previousDatabasePath = process.env['OPENAWORK_DATABASE_PATH'];

beforeAll(async () => {
  await closeDb();
  process.env['OPENAWORK_DATABASE_PATH'] = ':memory:';
  await connectDb();
  await migrate();
  sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
    'user-prune',
    'prune@example.test',
    'test',
  ]);
  sqliteRun('INSERT INTO sessions (id, user_id, title) VALUES (?, ?, ?)', [
    'session-prune',
    'user-prune',
    'prune test',
  ]);
});

afterAll(async () => {
  await closeDb();
  if (previousDatabasePath === undefined) delete process.env['OPENAWORK_DATABASE_PATH'];
  else process.env['OPENAWORK_DATABASE_PATH'] = previousDatabasePath;
});

describe('工具 part 延迟剪枝持久化', () => {
  it('仅写 compacted 时间并保留完整输出', () => {
    appendSessionMessageV2({
      sessionId: 'session-prune',
      userId: 'user-prune',
      role: 'assistant',
      content: [
        {
          type: 'tool_call',
          toolCallId: 'call-prune',
          toolName: 'batch',
          input: {},
        },
        {
          type: 'tool_result',
          toolCallId: 'call-prune',
          toolName: 'batch',
          output: '完整证据'.repeat(30_000),
          isError: false,
        },
      ],
    });

    expect(
      markToolPartsCompactedV2({
        sessionId: 'session-prune',
        userId: 'user-prune',
        toolCallIds: ['call-prune'],
        compactedAt: 1234,
      }),
    ).toBe(1);

    const message = listMessagesWithParts({
      sessionId: 'session-prune',
      userId: 'user-prune',
    })[0];
    const part = message?.parts.find((candidate) => candidate.type === 'tool');
    expect(part?.type).toBe('tool');
    if (part?.type !== 'tool' || part.state.status !== 'completed') {
      throw new Error('缺少已完成工具 part');
    }
    expect(part.state.time.compacted).toBe(1234);
    expect(part.state.output).toBe('完整证据'.repeat(30_000));
  });
});
