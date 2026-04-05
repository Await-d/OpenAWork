import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  listNotificationsMock,
  listNotificationPreferencesMock,
  markNotificationReadMock,
  upsertNotificationPreferencesMock,
} = vi.hoisted(() => ({
  listNotificationsMock: vi.fn(),
  listNotificationPreferencesMock: vi.fn(),
  markNotificationReadMock: vi.fn(),
  upsertNotificationPreferencesMock: vi.fn(),
}));

vi.mock('../auth.js', () => ({
  requireAuth: async (request: { user?: { sub: string } }) => {
    request.user = { sub: 'user-a' };
  },
}));

vi.mock('../request-workflow.js', () => ({
  startRequestWorkflow: () => ({
    step: { succeed: () => undefined, fail: () => undefined },
  }),
}));

vi.mock('../notification-store.js', () => ({
  listNotifications: listNotificationsMock,
  listNotificationPreferences: listNotificationPreferencesMock,
  markNotificationRead: markNotificationReadMock,
  upsertNotificationPreferences: upsertNotificationPreferencesMock,
  NOTIFICATION_PREFERENCE_CHANNELS: ['web'],
  NOTIFICATION_PREFERENCE_EVENT_TYPES: ['permission_asked', 'question_asked', 'task_update'],
}));

import { notificationsRoutes } from '../routes/notifications.js';

describe('notifications routes', () => {
  beforeEach(() => {
    listNotificationsMock.mockReset();
    listNotificationPreferencesMock.mockReset();
    markNotificationReadMock.mockReset();
    upsertNotificationPreferencesMock.mockReset();
  });

  it('returns notification preferences for the authenticated user', async () => {
    listNotificationPreferencesMock.mockReturnValueOnce([
      {
        channel: 'web',
        enabled: false,
        eventType: 'task_update',
        updatedAt: '2026-04-05T00:00:00.000Z',
      },
    ]);

    const app = Fastify();
    await app.register(notificationsRoutes);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/notifications/preferences?channel=web',
    });

    expect(response.statusCode).toBe(200);
    expect(listNotificationPreferencesMock).toHaveBeenCalledWith({
      channel: 'web',
      userId: 'user-a',
    });
    expect(JSON.parse(response.body)).toEqual({
      preferences: [
        {
          channel: 'web',
          enabled: false,
          eventType: 'task_update',
          updatedAt: '2026-04-05T00:00:00.000Z',
        },
      ],
    });

    await app.close();
  });

  it('persists notification preference updates', async () => {
    upsertNotificationPreferencesMock.mockReturnValueOnce([
      {
        channel: 'web',
        enabled: true,
        eventType: 'permission_asked',
        updatedAt: '2026-04-05T00:00:00.000Z',
      },
    ]);

    const app = Fastify();
    await app.register(notificationsRoutes);
    await app.ready();

    const response = await app.inject({
      method: 'PUT',
      url: '/notifications/preferences',
      payload: {
        channel: 'web',
        preferences: [{ eventType: 'permission_asked', enabled: true }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(upsertNotificationPreferencesMock).toHaveBeenCalledWith({
      channel: 'web',
      preferences: [{ eventType: 'permission_asked', enabled: true }],
      userId: 'user-a',
    });

    await app.close();
  });

  it('rejects invalid notification preference payloads', async () => {
    const app = Fastify();
    await app.register(notificationsRoutes);
    await app.ready();

    const response = await app.inject({
      method: 'PUT',
      url: '/notifications/preferences',
      payload: {
        channel: 'web',
        preferences: [{ eventType: 'unknown', enabled: true }],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(upsertNotificationPreferencesMock).not.toHaveBeenCalled();

    await app.close();
  });
});
