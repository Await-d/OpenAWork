// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationRecord } from '@openAwork/web-client';
import NotificationCenter from './NotificationCenter.js';
import { requestSessionListRefresh } from '../../../utils/session/session-list-events.js';

const mocks = vi.hoisted(() => ({
  listNotifications: vi.fn(),
  listPreferences: vi.fn(),
  markAllRead: vi.fn(),
  markRead: vi.fn(),
  updatePreferences: vi.fn(),
  listPendingPermissions: vi.fn(),
  replyPermission: vi.fn(),
  getSession: vi.fn(),
  navigate: vi.fn(),
  preloadRouteModuleByPath: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('react-router', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('@openAwork/web-client', () => ({
  createNotificationsClient: () => ({
    list: mocks.listNotifications,
    listPreferences: mocks.listPreferences,
    markAllRead: mocks.markAllRead,
    markRead: mocks.markRead,
    updatePreferences: mocks.updatePreferences,
  }),
  createPermissionsClient: () => ({
    listPending: mocks.listPendingPermissions,
    reply: mocks.replyPermission,
  }),
  createSessionsClient: () => ({
    get: mocks.getSession,
  }),
}));

vi.mock('../../../utils/chat/notification-preference-events.js', () => ({
  subscribeNotificationPreferenceRefresh: () => () => undefined,
}));

vi.mock('../../../routes/preloadable-route-modules.js', () => ({
  preloadRouteModuleByPath: mocks.preloadRouteModuleByPath,
}));

vi.mock('../../../utils/session/session-stream-resume-events.js', () => ({
  requestSessionStreamResumeAttach: vi.fn(),
}));

vi.mock('../../common/feedback/ToastNotification.js', () => ({
  toast: mocks.toast,
}));

describe('NotificationCenter', () => {
  let currentNotifications: NotificationRecord[];

  beforeEach(() => {
    currentNotifications = [
      {
        id: 'notif-1',
        title: '等待权限 · bash',
        body: 'requestId=perm-1\n需要执行工作区命令\n执行命令: git status -sb\ngit status -sb\nmedium',
        eventType: 'permission_asked',
        sessionId: 'session-1',
        createdAt: '2026-07-16T10:00:00.000Z',
        readAt: null,
        status: 'unread',
      },
    ];

    mocks.listNotifications.mockImplementation(async () => currentNotifications);
    mocks.listPreferences.mockResolvedValue([]);
    mocks.markAllRead.mockResolvedValue(undefined);
    mocks.markRead.mockResolvedValue(undefined);
    mocks.updatePreferences.mockResolvedValue([]);
    mocks.listPendingPermissions.mockResolvedValue([]);
    mocks.replyPermission.mockResolvedValue(undefined);
    mocks.getSession.mockResolvedValue(null);
    mocks.navigate.mockReset();
    mocks.preloadRouteModuleByPath.mockReset();
    mocks.toast.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('收到 session refresh 事件后会重新拉取通知并移除已处理的权限项', async () => {
    render(<NotificationCenter accessToken="token-test" gatewayUrl="https://gateway.test" />);

    const trigger = await screen.findByRole('button', { name: /通知/ });
    fireEvent.click(trigger);

    await screen.findByText('等待权限 · bash');

    currentNotifications = [];

    act(() => {
      requestSessionListRefresh();
    });

    await waitFor(() => {
      expect(screen.queryByText('等待权限 · bash')).toBeNull();
    });

    expect(mocks.listNotifications).toHaveBeenCalledTimes(3);
  });
});
