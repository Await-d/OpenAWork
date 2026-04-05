import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sqliteAllMock, sqliteRunMock } = vi.hoisted(() => ({
  sqliteAllMock: vi.fn(),
  sqliteRunMock: vi.fn(),
}));

vi.mock('../db.js', () => ({
  sqliteAll: sqliteAllMock,
  sqliteRun: sqliteRunMock,
}));

import {
  listSharedSessionPresence,
  touchSharedSessionPresence,
} from '../session-shared-presence-store.js';

describe('session shared presence store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists recent viewers and marks active viewers within the window', () => {
    sqliteAllMock.mockReturnValueOnce([
      {
        viewer_user_id: 'viewer-1',
        viewer_email: 'viewer@openawork.local',
        first_seen_at_ms: 1_710_000_000_000,
        last_seen_at_ms: 1_710_000_080_000,
      },
      {
        viewer_user_id: 'viewer-2',
        viewer_email: 'observer@openawork.local',
        first_seen_at_ms: 1_710_000_000_000,
        last_seen_at_ms: 1_709_999_900_000,
      },
    ]);

    const presence = listSharedSessionPresence({
      ownerUserId: 'owner-1',
      sessionId: 'shared-session-1',
      nowMs: 1_710_000_100_000,
    });

    expect(sqliteRunMock).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM shared_session_presence'),
      ['owner-1', 'shared-session-1'],
    );
    expect(sqliteAllMock).toHaveBeenCalledWith(
      expect.stringContaining('FROM shared_session_presence'),
      ['owner-1', 'shared-session-1', 8],
    );
    expect(presence).toEqual([
      expect.objectContaining({ viewerEmail: 'viewer@openawork.local', active: true }),
      expect.objectContaining({ viewerEmail: 'observer@openawork.local', active: false }),
    ]);
  });

  it('touches shared session presence and returns the refreshed viewer list', () => {
    sqliteAllMock.mockReturnValueOnce([
      {
        viewer_user_id: 'viewer-1',
        viewer_email: 'viewer@openawork.local',
        first_seen_at_ms: 1_710_000_000_000,
        last_seen_at_ms: 1_710_000_100_000,
      },
    ]);

    const presence = touchSharedSessionPresence({
      ownerUserId: 'owner-1',
      sessionId: 'shared-session-1',
      viewerUserId: 'viewer-1',
      viewerEmail: 'viewer@openawork.local',
      nowMs: 1_710_000_100_000,
    });

    expect(sqliteRunMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO shared_session_presence'),
      [
        'owner-1',
        'shared-session-1',
        'viewer-1',
        'viewer@openawork.local',
        1_710_000_100_000,
        1_710_000_100_000,
      ],
    );
    expect(presence[0]).toMatchObject({
      viewerEmail: 'viewer@openawork.local',
      active: true,
    });
  });
});
