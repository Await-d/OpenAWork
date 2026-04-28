import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  emitEvent: vi.fn(),
  sqliteGet: vi.fn(),
  sqliteRun: vi.fn(),
  upsertSearchDocument: vi.fn(),
}));

vi.mock('../db.js', () => ({
  sqliteAll: vi.fn(() => []),
  sqliteGet: mocks.sqliteGet,
  sqliteRun: mocks.sqliteRun,
}));

vi.mock('../sync-event.js', () => ({
  emitEvent: mocks.emitEvent,
  MessageEvents: {
    Created: { type: 'message.created', version: 1 },
    PartCreated: { type: 'message.part.created', version: 1 },
    PartUpdated: { type: 'message.part.updated', version: 1 },
  },
  publishBusEvent: vi.fn(),
  SessionBusEvents: {},
  SessionEvents: {},
  TodoBusEvents: {},
}));

vi.mock('../message-v2-projectors.js', () => ({}));

vi.mock('../session-search-store.js', () => ({
  upsertSessionMessageSearchDocument: mocks.upsertSearchDocument,
}));

import { appendSessionMessageV2 } from '../message-v2-adapter.js';
import { hasSessionMessage } from '../session-message-rating-store.js';

describe('message-v2 compatibility regressions', () => {
  beforeEach(() => {
    mocks.emitEvent.mockClear();
    mocks.sqliteGet.mockReset();
    mocks.sqliteRun.mockClear();
    mocks.upsertSearchDocument.mockClear();
  });

  it('mirrors v2 writes into the legacy search index path', () => {
    mocks.sqliteGet.mockReturnValue({ max_seq: null });

    appendSessionMessageV2({
      sessionId: 'session-1',
      userId: 'user-1',
      role: 'user',
      messageId: 'message-1',
      createdAt: 123,
      content: [{ type: 'text', text: 'needle-v2-search' }],
    });

    expect(mocks.sqliteRun).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO session_messages'),
      expect.arrayContaining(['message-1', 'session-1', 'user-1', 1, 'user']),
    );
    expect(mocks.upsertSearchDocument).toHaveBeenCalledWith({
      contentJson: JSON.stringify([{ type: 'text', text: 'needle-v2-search' }]),
      id: 'message-1',
      role: 'user',
      sessionId: 'session-1',
      userId: 'user-1',
    });
  });

  it('recognizes message_v2 rows when validating message ratings', () => {
    mocks.sqliteGet.mockReturnValue({ id: 'message-v2-only' });

    expect(
      hasSessionMessage({
        messageId: 'message-v2-only',
        sessionId: 'session-1',
        userId: 'user-1',
      }),
    ).toBe(true);

    expect(mocks.sqliteGet).toHaveBeenCalledWith(expect.stringContaining('FROM message_v2'), [
      'session-1',
      'user-1',
      'message-v2-only',
      'session-1',
      'user-1',
      'message-v2-only',
    ]);
  });
});
