import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sqliteAllMock: vi.fn(),
  sqliteRunMock: vi.fn(),
}));

vi.mock('../db.js', () => ({
  sqliteAll: mocks.sqliteAllMock,
  sqliteRun: mocks.sqliteRunMock,
}));

import {
  buildNotificationFromRunEvent,
  listNotifications,
  listNotificationPreferences,
  markNotificationRead,
  upsertNotificationPreferences,
} from '../notification-store.js';

describe('notification store', () => {
  beforeEach(() => {
    mocks.sqliteAllMock.mockReset();
    mocks.sqliteRunMock.mockReset();
  });

  it('lists notifications in descending order', () => {
    mocks.sqliteAllMock.mockReturnValueOnce([
      {
        id: 'notification-1',
        session_id: 'session-1',
        event_type: 'permission_asked',
        title: '等待权限 · bash',
        body: '运行验证命令',
        status: 'unread',
        read_at: null,
        created_at: '2026-04-05T00:00:00.000Z',
      },
    ]);

    const notifications = listNotifications({ limit: 10, userId: 'user-1', status: 'unread' });
    expect(notifications[0]?.title).toBe('等待权限 · bash');
  });

  it('creates notifications from run events that matter to users', () => {
    buildNotificationFromRunEvent({
      id: 'notification-1',
      sessionId: 'session-1',
      userId: 'user-1',
      event: {
        type: 'permission_asked',
        requestId: 'perm-1',
        toolName: 'bash',
        scope: 'session',
        reason: '需要执行命令',
        riskLevel: 'medium',
        previewAction: '运行验证命令',
      },
    });

    expect(mocks.sqliteRunMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO notifications'),
      [
        'notification-1',
        'user-1',
        'session-1',
        'permission_asked',
        '等待权限 · bash',
        '运行验证命令',
      ],
    );
  });

  it('marks notifications as read', () => {
    markNotificationRead({ id: 'notification-1', userId: 'user-1' });
    expect(mocks.sqliteRunMock).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE notifications'),
      ['notification-1', 'user-1'],
    );
  });

  it('falls back to enabled defaults for missing notification preferences', () => {
    mocks.sqliteAllMock.mockReturnValueOnce([
      {
        channel: 'web',
        event_type: 'question_asked',
        enabled: 0,
        updated_at: '2026-04-05T00:00:00.000Z',
      },
    ]);

    const preferences = listNotificationPreferences({ channel: 'web', userId: 'user-1' });
    expect(preferences).toEqual([
      {
        channel: 'web',
        enabled: true,
        eventType: 'permission_asked',
        updatedAt: null,
      },
      {
        channel: 'web',
        enabled: false,
        eventType: 'question_asked',
        updatedAt: '2026-04-05T00:00:00.000Z',
      },
      {
        channel: 'web',
        enabled: true,
        eventType: 'task_update',
        updatedAt: null,
      },
    ]);
  });

  it('upserts notification preferences and returns the merged result', () => {
    mocks.sqliteAllMock.mockReturnValueOnce([
      {
        channel: 'web',
        event_type: 'permission_asked',
        enabled: 0,
        updated_at: '2026-04-05T00:00:00.000Z',
      },
      {
        channel: 'web',
        event_type: 'question_asked',
        enabled: 1,
        updated_at: '2026-04-05T00:00:00.000Z',
      },
    ]);

    const preferences = upsertNotificationPreferences({
      channel: 'web',
      preferences: [
        { eventType: 'permission_asked', enabled: false },
        { eventType: 'question_asked', enabled: true },
      ],
      userId: 'user-1',
    });

    expect(mocks.sqliteRunMock).toHaveBeenCalledTimes(2);
    expect(mocks.sqliteRunMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO notification_preferences'),
      ['user-1', 'web', 'permission_asked', 0],
    );
    expect(preferences[0]).toEqual({
      channel: 'web',
      enabled: false,
      eventType: 'permission_asked',
      updatedAt: '2026-04-05T00:00:00.000Z',
    });
  });
});
