const COMPACTED_REFERENCE_MARKER = '"microcompacted":true';

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appendSessionMessageV2, listSessionMessagesV2 } from '../../message/message-v2-adapter.js';
import { microcompactMessages } from '../../compaction/microcompact.js';
import type { UnifiedMessage } from '../../message/message-to-model-messages.js';
import * as db from '../../infra/db.js';

const USER_ID = 'manual-qa-compaction-user';
const SESSION_ID = 'manual-qa-compaction-session';

type StoredRow = {
  readonly data: string;
  readonly id: string;
  readonly message_id: string | null;
};

type StoredRowBytes = {
  readonly data: Buffer;
  readonly id: string;
  readonly message_id: string | null;
};

let previousDatabasePath: string | undefined;
let temporaryDatabaseDirectory = '';

function snapshot(table: 'message_v2' | 'part_v2'): StoredRowBytes[] {
  const columns = table === 'part_v2' ? 'id, message_id, data' : 'id, NULL AS message_id, data';
  return db
    .sqliteAll<StoredRow>(`SELECT ${columns} FROM ${table} WHERE session_id = ? ORDER BY id`, [
      SESSION_ID,
    ])
    .map((row) => ({ ...row, data: Buffer.from(row.data, 'utf8') }));
}

function seedSession(): void {
  db.sqliteRun('DELETE FROM sessions WHERE id = ?', [SESSION_ID]);
  db.sqliteRun('DELETE FROM users WHERE id = ?', [USER_ID]);
  db.sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
    USER_ID,
    `${USER_ID}@example.test`,
    'test',
  ]);
  db.sqliteRun('INSERT INTO sessions (id, user_id, title, metadata_json) VALUES (?, ?, ?, ?)', [
    SESSION_ID,
    USER_ID,
    'manual qa compaction atomic',
    '{}',
  ]);
}

beforeAll(async () => {
  previousDatabasePath = process.env['OPENAWORK_DATABASE_PATH'];
  temporaryDatabaseDirectory = await mkdtemp(join(tmpdir(), 'openawork-task-2-atomic-'));
  await db.closeDb();
  process.env['OPENAWORK_DATABASE_PATH'] = join(temporaryDatabaseDirectory, 'gateway.sqlite');
  await db.connectDb();
  await db.migrate();
});

beforeEach(seedSession);

afterAll(async () => {
  await db.closeDb();
  if (previousDatabasePath === undefined) {
    delete process.env['OPENAWORK_DATABASE_PATH'];
  } else {
    process.env['OPENAWORK_DATABASE_PATH'] = previousDatabasePath;
  }
  await rm(temporaryDatabaseDirectory, { force: true, recursive: true });
  await db.connectDb();
});

describe('manual QA compaction atomicity', () => {
  it('只改渲染输入，file-backed SQLite message_v2 与 part_v2 原始字节在重载后保持不变', async () => {
    appendSessionMessageV2({
      sessionId: SESSION_ID,
      userId: USER_ID,
      role: 'assistant',
      content: [
        {
          type: 'tool_call',
          toolCallId: 'manual-qa-tool',
          toolName: 'read_file',
          input: { path: 'atomic.ts' },
        },
      ],
      clientRequestId: 'manual-qa-assistant',
      modelID: 'stub-model',
      providerID: 'custom',
    });
    appendSessionMessageV2({
      sessionId: SESSION_ID,
      userId: USER_ID,
      role: 'tool',
      content: [
        {
          type: 'tool_result',
          toolCallId: 'manual-qa-tool',
          toolName: 'read_file',
          output: 'durable output '.repeat(30),
          isError: false,
        },
      ],
      clientRequestId: 'manual-qa-tool-result',
    });

    const beforeMessages = snapshot('message_v2');
    const beforeParts = snapshot('part_v2');
    const modelMessages: UnifiedMessage[] = [
      {
        role: 'tool',
        toolCallId: 'manual-qa-tool',
        toolName: 'read_file',
        content: 'durable output '.repeat(30),
      },
      {
        role: 'tool',
        toolCallId: 'manual-qa-tool-recent',
        toolName: 'read_file',
        content: 'recent output '.repeat(30),
      },
    ];

    const compacted = microcompactMessages(modelMessages, {
      triggerThreshold: 0,
      keepRecent: 1,
    });

    expect(compacted.trigger).toBe('count');
    expect(compacted.messages[0]?.content).toContain(COMPACTED_REFERENCE_MARKER);

    await db.closeDb();
    await db.connectDb();

    expect(listSessionMessagesV2({ sessionId: SESSION_ID, userId: USER_ID })).toHaveLength(1);
    expect(snapshot('message_v2')).toEqual(beforeMessages);
    expect(snapshot('part_v2')).toEqual(beforeParts);
  });
});
