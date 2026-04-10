import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sqliteAllMock, sqliteGetMock } = vi.hoisted(() => ({
  sqliteAllMock: vi.fn(),
  sqliteGetMock: vi.fn(),
}));

vi.mock('../db.js', () => ({
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_ROOTS: ['/repo'],
  sqliteAll: sqliteAllMock,
  sqliteGet: sqliteGetMock,
}));

import {
  getSharedSessionForRecipient,
  listSharedSessionsForRecipient,
} from '../session-shared-access.js';

describe('session shared access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqliteAllMock.mockReturnValue([
      {
        session_id: 'shared-session-1',
        messages_json: '[]',
        session_state_status: 'paused',
        session_metadata_json: JSON.stringify({ workingDirectory: '/repo/apps/api' }),
        session_title: '上线回顾',
        session_created_at: '2026-04-04T03:00:00.000Z',
        session_updated_at: '2026-04-04T03:30:00.000Z',
        owner_user_id: 'owner-1',
        permission: 'view',
        share_created_at: '2026-04-04T04:00:00.000Z',
        share_updated_at: '2026-04-04T04:15:00.000Z',
        shared_by_email: 'owner@openawork.local',
      },
    ]);
    sqliteGetMock.mockReturnValue({
      session_id: 'shared-session-1',
      messages_json: '[]',
      session_state_status: 'paused',
      session_metadata_json: JSON.stringify({ workingDirectory: '/repo/apps/api' }),
      session_title: '上线回顾',
      session_created_at: '2026-04-04T03:00:00.000Z',
      session_updated_at: '2026-04-04T03:30:00.000Z',
      owner_user_id: 'owner-1',
      permission: 'view',
      share_created_at: '2026-04-04T04:00:00.000Z',
      share_updated_at: '2026-04-04T04:15:00.000Z',
      shared_by_email: 'owner@openawork.local',
    });
  });

  it('lists shared sessions for the recipient email with workspace projection', () => {
    const sessions = listSharedSessionsForRecipient({
      email: 'member@openawork.local',
      limit: 20,
      offset: 0,
    });

    expect(sqliteAllMock).toHaveBeenCalledWith(
      expect.stringContaining('lower(tm.email) = lower(?)'),
      ['member@openawork.local', 20, 0],
    );
    expect(sessions[0]).toMatchObject({
      ownerUserId: 'owner-1',
      permission: 'view',
      sharedByEmail: 'owner@openawork.local',
      session: {
        id: 'shared-session-1',
        title: '上线回顾',
        workspacePath: '/repo/apps/api',
      },
    });
  });

  it('gets a shared session by recipient email and session id', () => {
    const session = getSharedSessionForRecipient({
      email: 'member@openawork.local',
      sessionId: 'shared-session-1',
    });

    expect(sqliteGetMock).toHaveBeenCalledWith(
      expect.stringContaining('WHERE sess.id = ? AND lower(tm.email) = lower(?)'),
      ['shared-session-1', 'member@openawork.local'],
    );
    expect(session?.session.workspacePath).toBe('/repo/apps/api');
  });

  it('returns null when the current user has no matching shared session', () => {
    sqliteGetMock.mockReturnValueOnce(undefined);

    const session = getSharedSessionForRecipient({
      email: 'unknown@openawork.local',
      sessionId: 'shared-session-1',
    });

    expect(session).toBeNull();
  });

  it('inherits workspacePath from parent session metadata when child metadata omits workingDirectory', () => {
    sqliteAllMock.mockReturnValueOnce([
      {
        session_id: 'shared-session-2',
        messages_json: '[]',
        session_state_status: 'paused',
        session_metadata_json: JSON.stringify({ parentSessionId: 'parent-session-1' }),
        session_title: '子代理检索',
        session_created_at: '2026-04-04T03:10:00.000Z',
        session_updated_at: '2026-04-04T03:40:00.000Z',
        owner_user_id: 'owner-1',
        permission: 'view',
        share_created_at: '2026-04-04T04:20:00.000Z',
        share_updated_at: '2026-04-04T04:25:00.000Z',
        shared_by_email: 'owner@openawork.local',
      },
    ]);
    sqliteGetMock.mockImplementationOnce((sql: string) => {
      if (sql.includes('SELECT metadata_json FROM sessions')) {
        return { metadata_json: JSON.stringify({ workingDirectory: '/repo/apps/api' }) };
      }
      return undefined;
    });

    const sessions = listSharedSessionsForRecipient({
      email: 'member@openawork.local',
      limit: 20,
      offset: 0,
    });

    expect(sessions[0]?.session.workspacePath).toBe('/repo/apps/api');
  });

  it('inherits workspacePath through a multi-level parent chain', () => {
    sqliteAllMock.mockReturnValueOnce([
      {
        session_id: 'shared-session-3',
        messages_json: '[]',
        session_state_status: 'paused',
        session_metadata_json: JSON.stringify({ parentSessionId: 'child-session-1' }),
        session_title: '孙子代理整理',
        session_created_at: '2026-04-04T03:20:00.000Z',
        session_updated_at: '2026-04-04T03:50:00.000Z',
        owner_user_id: 'owner-1',
        permission: 'view',
        share_created_at: '2026-04-04T04:30:00.000Z',
        share_updated_at: '2026-04-04T04:35:00.000Z',
        shared_by_email: 'owner@openawork.local',
      },
    ]);
    sqliteGetMock
      .mockImplementationOnce((sql: string) => {
        if (sql.includes('SELECT metadata_json FROM sessions')) {
          return { metadata_json: JSON.stringify({ parentSessionId: 'root-session-1' }) };
        }
        return undefined;
      })
      .mockImplementationOnce((sql: string) => {
        if (sql.includes('SELECT metadata_json FROM sessions')) {
          return { metadata_json: JSON.stringify({ workingDirectory: '/repo/apps/api' }) };
        }
        return undefined;
      });

    const sessions = listSharedSessionsForRecipient({
      email: 'member@openawork.local',
      limit: 20,
      offset: 0,
    });

    expect(sessions[0]?.session.workspacePath).toBe('/repo/apps/api');
  });
});
