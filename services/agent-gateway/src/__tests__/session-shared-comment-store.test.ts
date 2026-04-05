import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sqliteAllMock, sqliteGetMock, sqliteRunMock } = vi.hoisted(() => ({
  sqliteAllMock: vi.fn(),
  sqliteGetMock: vi.fn(),
  sqliteRunMock: vi.fn(),
}));

vi.mock('../db.js', () => ({
  sqliteAll: sqliteAllMock,
  sqliteGet: sqliteGetMock,
  sqliteRun: sqliteRunMock,
}));

vi.mock('node:crypto', () => ({
  randomUUID: () => 'comment-1',
}));

import {
  createSharedSessionComment,
  listSharedSessionComments,
} from '../session-shared-comment-store.js';

describe('session shared comment store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists comments for a shared session', () => {
    sqliteAllMock.mockReturnValueOnce([
      {
        id: 'comment-1',
        session_id: 'shared-session-1',
        author_email: 'viewer@openawork.local',
        content: '我补一条评论',
        created_at: '2026-04-04T05:00:00.000Z',
      },
    ]);

    const comments = listSharedSessionComments({
      ownerUserId: 'owner-1',
      sessionId: 'shared-session-1',
    });

    expect(sqliteAllMock).toHaveBeenCalledWith(
      expect.stringContaining('FROM shared_session_comments'),
      ['owner-1', 'shared-session-1'],
    );
    expect(comments).toEqual([
      {
        id: 'comment-1',
        sessionId: 'shared-session-1',
        authorEmail: 'viewer@openawork.local',
        content: '我补一条评论',
        createdAt: '2026-04-04T05:00:00.000Z',
      },
    ]);
  });

  it('creates a new shared session comment', () => {
    sqliteGetMock.mockReturnValueOnce({
      id: 'comment-1',
      session_id: 'shared-session-1',
      author_email: 'viewer@openawork.local',
      content: '我补一条评论',
      created_at: '2026-04-04 05:00:00',
    });

    const comment = createSharedSessionComment({
      ownerUserId: 'owner-1',
      sessionId: 'shared-session-1',
      authorUserId: 'viewer-1',
      authorEmail: 'viewer@openawork.local',
      content: '我补一条评论',
    });

    expect(sqliteRunMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO shared_session_comments'),
      [
        'comment-1',
        'owner-1',
        'shared-session-1',
        'viewer-1',
        'viewer@openawork.local',
        '我补一条评论',
      ],
    );
    expect(sqliteGetMock).toHaveBeenCalledWith(
      expect.stringContaining('FROM shared_session_comments'),
      ['comment-1', 'owner-1'],
    );
    expect(comment).toMatchObject({
      id: 'comment-1',
      sessionId: 'shared-session-1',
      authorEmail: 'viewer@openawork.local',
      content: '我补一条评论',
      createdAt: '2026-04-04 05:00:00',
    });
  });
});
