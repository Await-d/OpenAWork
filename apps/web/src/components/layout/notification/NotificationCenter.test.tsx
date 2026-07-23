// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationRecord, PendingPermissionRequest } from '@openAwork/web-client';
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

const LIVE_PENDING: PendingPermissionRequest = {
  requestId: 'perm-1',
  sessionId: 'session-1',
  toolName: 'bash',
  scope: 'git status -sb',
  reason: '需要执行工作区命令',
  riskLevel: 'medium',
  previewAction: '执行命令: git status -sb',
  status: 'pending',
  createdAt: '2026-07-16T10:00:00.000Z',
};

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
    // Default: keep the permission live so the notification is not auto-dismissed.
    mocks.listPendingPermissions.mockResolvedValue([LIVE_PENDING]);
    mocks.replyPermission.mockResolvedValue(undefined);
    mocks.getSession.mockResolvedValue(null);
    mocks.navigate.mockReset();
    mocks.preloadRouteModuleByPath.mockReset();
    mocks.toast.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('收到 session refresh 事件后会重新拉取通知并移除已处理的权限项', async () => {
    render(<NotificationCenter accessToken="token-test" gatewayUrl="https://gateway.test" />);

    const trigger = await screen.findByTitle('通知中心');
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

  it('listPending 为空时会自动标记已读并移出列表', async () => {
    mocks.listPendingPermissions.mockResolvedValue([]);

    render(<NotificationCenter accessToken="token-test" gatewayUrl="https://gateway.test" />);

    await waitFor(() => {
      expect(mocks.markRead).toHaveBeenCalledWith('token-test', 'notif-1');
    });

    // Badge should disappear after stale permission notification is auto-dismissed.
    await waitFor(() => {
      const trigger = screen.getByTitle('通知中心');
      expect(trigger.textContent).not.toMatch(/1/);
    });
  });

  it('旧格式通知无 requestId、会话仍有其它 pending 时，不误删通知，只隐藏审批按钮', async () => {
    // 旧格式 body 不含 requestId= 前缀，无法精确匹配；会话里还有别的 pending，
    // 不应因模糊匹配失败就 markRead 清掉。
    currentNotifications = [
      {
        id: 'notif-legacy',
        title: '等待权限 · bash',
        body: '需要执行工作区命令\n执行命令: git status -sb\ngit status -sb\nmedium',
        eventType: 'permission_asked',
        sessionId: 'session-1',
        createdAt: '2026-07-16T10:00:00.000Z',
        readAt: null,
        status: 'unread',
      },
    ];
    // 至少 2 条异工具 pending：旧匹配器在 length===1 时会兜底误配。
    mocks.listPendingPermissions.mockResolvedValue([
      {
        requestId: 'perm-write',
        sessionId: 'session-1',
        toolName: 'write',
        scope: 'write:workspace',
        reason: '写入文件',
        riskLevel: 'high',
        previewAction: 'write /tmp/a.md',
        status: 'pending',
        createdAt: '2026-07-16T10:00:00.000Z',
      },
      {
        requestId: 'perm-edit',
        sessionId: 'session-1',
        toolName: 'edit',
        scope: 'edit:workspace',
        reason: '编辑文件',
        riskLevel: 'medium',
        previewAction: 'edit /tmp/b.md',
        status: 'pending',
        createdAt: '2026-07-16T10:01:00.000Z',
      },
    ]);

    render(<NotificationCenter accessToken="token-test" gatewayUrl="https://gateway.test" />);

    const trigger = await screen.findByTitle('通知中心');
    fireEvent.click(trigger);

    await screen.findByText('等待权限 · bash');
    await waitFor(() => {
      expect(mocks.listPendingPermissions).toHaveBeenCalled();
    });

    expect(mocks.markRead).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '允许一次' })).toBeNull();
  });

  it('快捷审批返回 409 时会提示并移除该通知', async () => {
    mocks.replyPermission.mockRejectedValue(
      Object.assign(new Error('权限请求已处理，无法重复提交。'), {
        status: 409,
        data: { error: '权限请求已处理，无法重复提交。' },
      }),
    );

    render(<NotificationCenter accessToken="token-test" gatewayUrl="https://gateway.test" />);

    const trigger = await screen.findByTitle('通知中心');
    fireEvent.click(trigger);

    const allowOnce = await screen.findByRole('button', { name: '允许一次' });
    fireEvent.click(allowOnce);

    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith('该权限请求已被处理或已过期', 'info');
    });
    await waitFor(() => {
      expect(mocks.markRead).toHaveBeenCalledWith('token-test', 'notif-1');
    });
    await waitFor(() => {
      expect(screen.queryByText('等待权限 · bash')).toBeNull();
    });
  });
});
