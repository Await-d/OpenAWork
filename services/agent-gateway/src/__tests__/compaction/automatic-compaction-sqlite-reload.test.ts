import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '@openAwork/shared';
import type { ModelRouteConfig } from '../../provider/model-router.js';
import type { CompactionSettings } from '../../compaction/compaction-policy.js';

const mocks = vi.hoisted(() => ({
  publishSessionRunEvent: vi.fn(),
  executeSessionCompaction: vi.fn(),
}));

vi.mock('../../session/session-run-events.js', () => ({
  publishSessionRunEvent: mocks.publishSessionRunEvent,
}));
vi.mock('../../session/session-compaction.js', () => ({
  executeSessionCompaction: mocks.executeSessionCompaction,
  isAutoCompactCircuitBreakerTripped: vi.fn(() => false),
}));

import {
  appendSessionMessageV2,
  listSessionMessagesV2,
} from '../../message/message-v2-adapter.js';
import { filterCompacted, toModelMessages } from '../../message/message-to-model-messages.js';
import { streamMessagesWithParts } from '../../message/message-store-v2.js';
import { triggerOverflowCompaction } from '../../compaction/auto-compaction-trigger.js';
import { parseContextLimitError } from '../../compaction/context-window-resolver.js';
import * as db from '../../infra/db.js';

const USER_ID = 'automatic-compaction-reload-user';
const SESSION_ID = 'automatic-compaction-reload-session';

const ROUTE: ModelRouteConfig = {
  model: 'stub-model',
  apiBaseUrl: 'http://127.0.0.1:9',
  apiKey: 'stub-key',
  contextWindow: 100_000,
  maxTokens: 2_000,
  temperature: 0,
  upstreamProtocol: 'chat_completions',
  requestOverrides: {},
  supportsThinking: false,
};

const COMPACTION_SETTINGS: CompactionSettings = {
  auto: true,
  prune: true,
  recentMessagesKept: 2,
};

function textMessage(
  role: Message['role'],
  text: string,
  clientRequestId: string,
  messageId: string,
): Parameters<typeof appendSessionMessageV2>[0] {
  return {
    clientRequestId,
    content: [{ type: 'text', text }],
    messageId,
    role,
    sessionId: SESSION_ID,
    status: 'final',
    userId: USER_ID,
  };
}

function seedSession(): void {
  db.sqliteRun('DELETE FROM sessions WHERE id = ?', [SESSION_ID]);
  db.sqliteRun('DELETE FROM users WHERE id = ?', [USER_ID]);
  db.sqliteRun(
    'INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)',
    [USER_ID, `${USER_ID}@example.test`, 'test'],
  );
  db.sqliteRun('INSERT INTO sessions (id, user_id, title, metadata_json) VALUES (?, ?, ?, ?)', [
    SESSION_ID,
    USER_ID,
    'automatic compaction reload',
    '{}',
  ]);

  appendSessionMessageV2(
    textMessage('user', 'old history '.repeat(10_000), 'round-old', 'message-old-user'),
  );
  appendSessionMessageV2(
    textMessage('assistant', 'recent answer', 'round-recent', 'message-recent-assistant'),
  );
}

beforeAll(async () => {
  await db.connectDb();
  await db.migrate();
});

beforeEach(() => {
  mocks.publishSessionRunEvent.mockReset();
  mocks.executeSessionCompaction.mockReset();
  seedSession();
});

afterAll(() => {
  db.sqliteRun('DELETE FROM sessions WHERE id = ?', [SESSION_ID]);
  db.sqliteRun('DELETE FROM users WHERE id = ?', [USER_ID]);
});

describe('automatic compaction SQLite reload', () => {
  it('stub upstream overflow 后，reload 的模型输入只保留 reactive 投影尾部', async () => {
    expect(listSessionMessagesV2({ sessionId: SESSION_ID, userId: USER_ID })).toHaveLength(2);
    expect(parseContextLimitError({ message: 'prompt is too long: 120000 tokens > 100000 maximum' })).toMatchObject({
      currentTokens: 120_000,
      maxTokens: 100_000,
    });
    mocks.executeSessionCompaction.mockResolvedValue({
      durableSummary: null,
      metadata: {},
      metadataJson: '{}',
      summary: 'fallback',
    });
    const result = await triggerOverflowCompaction({
      clientRequestId: 'reload-request',
      compactionSettings: COMPACTION_SETTINGS,
      metadataJson: '{}',
      route: ROUTE,
      round: 2,
      runId: 'reload-run',
      sessionId: SESSION_ID,
      signal: new AbortController().signal,
      userId: USER_ID,
      roundResult: {
        overflow: true,
        stopReason: 'error',
        upstreamError: { message: 'prompt is too long: 120000 tokens > 100000 maximum' },
      },
    });

    expect(result).toMatchObject({ triggered: true, recovered: true });
    expect(mocks.executeSessionCompaction).not.toHaveBeenCalled();

    const reloaded = listSessionMessagesV2({ sessionId: SESSION_ID, userId: USER_ID });
    const persistedMessages = Array.from(
      streamMessagesWithParts({ sessionId: SESSION_ID, userId: USER_ID }),
    );
    expect(persistedMessages.map((message) => message.info.id)).toContain('message-recent-assistant');
    const modelInput = toModelMessages(
      filterCompacted(persistedMessages),
    );
    const serializedInput = JSON.stringify(modelInput);

    expect(reloaded.some((message) => message.content.some((part) => part.type === 'text' && part.text.includes('old history')))).toBe(true);
    expect(modelInput.some((message) => message.content === 'old history '.repeat(10_000))).toBe(false);
    expect(serializedInput).toContain('old history');
    expect(serializedInput).toContain('recent answer');
  });
});
