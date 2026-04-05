import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sqliteAllMock: vi.fn(),
  sqliteGetMock: vi.fn(),
  sqliteRunMock: vi.fn(),
}));

vi.mock('../db.js', () => ({
  sqliteAll: mocks.sqliteAllMock,
  sqliteGet: mocks.sqliteGetMock,
  sqliteRun: mocks.sqliteRunMock,
}));

import {
  deleteSessionMessageRating,
  hasSessionMessage,
  listSessionMessageRatings,
  upsertSessionMessageRating,
} from '../session-message-rating-store.js';

describe('session message rating store', () => {
  beforeEach(() => {
    mocks.sqliteAllMock.mockReset();
    mocks.sqliteGetMock.mockReset();
    mocks.sqliteRunMock.mockReset();
  });

  it('lists rating records for a session', () => {
    mocks.sqliteAllMock.mockReturnValueOnce([
      {
        message_id: 'message-1',
        rating: 'up',
        reason: null,
        notes: null,
        updated_at: '2026-04-05T00:00:00.000Z',
      },
    ]);

    const ratings = listSessionMessageRatings({ sessionId: 'session-1', userId: 'user-1' });
    expect(ratings).toEqual([
      {
        messageId: 'message-1',
        rating: 'up',
        reason: null,
        notes: null,
        updatedAt: '2026-04-05T00:00:00.000Z',
      },
    ]);
  });

  it('upserts and re-reads a message rating record', () => {
    mocks.sqliteGetMock.mockReturnValueOnce({
      message_id: 'message-1',
      rating: 'down',
      reason: 'wrong',
      notes: null,
      updated_at: '2026-04-05T00:00:00.000Z',
    });

    const record = upsertSessionMessageRating({
      messageId: 'message-1',
      rating: 'down',
      reason: 'wrong',
      sessionId: 'session-1',
      userId: 'user-1',
    });

    expect(mocks.sqliteRunMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO message_ratings'),
      ['session-1', 'user-1', 'message-1', 'down', 'wrong', null],
    );
    expect(record.rating).toBe('down');
    expect(record.reason).toBe('wrong');
  });

  it('checks message existence and deletes ratings', () => {
    mocks.sqliteGetMock.mockReturnValueOnce({ id: 'message-1' });

    expect(
      hasSessionMessage({ messageId: 'message-1', sessionId: 'session-1', userId: 'user-1' }),
    ).toBe(true);

    deleteSessionMessageRating({
      messageId: 'message-1',
      sessionId: 'session-1',
      userId: 'user-1',
    });
    expect(mocks.sqliteRunMock).toHaveBeenCalledWith(
      'DELETE FROM message_ratings WHERE session_id = ? AND user_id = ? AND message_id = ?',
      ['session-1', 'user-1', 'message-1'],
    );
  });
});
