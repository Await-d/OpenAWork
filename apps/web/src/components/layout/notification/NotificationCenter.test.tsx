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
  archive: vi.fn(),
  archiveMany: vi.fn(),
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
    archive: mocks.archive,
    archiveMany: mocks.archiveMany,
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

/** 客户端 list() 返回 `{ notifications, pendingActionableCount, browserBroadcasts }`。 */
function toListResult(
  items: NotificationRecord[],
  browserBroadcasts: NotificationRecord[] = [],
): {
  browserBroadcasts: NotificationRecord[];
  notifications: NotificationRecord[];
  pendingActionableCount: number;
} {
  return {
    browserBroadcasts,
    notifications: items,
    pendingActionableCount: items.filter(
      (item) => item.kind === 'actionable' && item.status === 'unread',
    ).length,
  };
}

describe('NotificationCenter', () => {
  let currentNotifications: NotificationRecord[];
  /** 服务端 `view=pending` 不返回结果播报，只在 browserBroadcasts 里附带。 */
  let currentBroadcasts: NotificationRecord[];
  /** `view=all` / `view=archived` 返回的行（含 informational）。 */
  let currentArchiveView: NotificationRecord[];

  beforeEach(() => {
    currentNotifications = [
      {
        id: 'notif-1',
        title: '等待权限 · bash',
        body: 'requestId=perm-1\n需要执行工作区命令\n执行命令: git status -sb\ngit status -sb\nmedium',
        eventType: 'permission_asked',
        kind: 'actionable',
        sessionId: 'session-1',
        createdAt: '2026-07-16T10:00:00.000Z',
        readAt: null,
        actedAt: null,
        archivedAt: null,
        expiresAt: null,
        status: 'unread',
      },
    ];
    currentBroadcasts = [];
    currentArchiveView = [];

    mocks.listNotifications.mockImplementation(
      async (_token: string, options?: { view?: string }) =>
        options?.view === 'pending'
          ? toListResult(currentNotifications, currentBroadcasts)
          : toListResult(currentArchiveView),
    );
    mocks.listPreferences.mockResolvedValue([]);
    mocks.markAllRead.mockResolvedValue(undefined);
    mocks.markRead.mockResolvedValue(undefined);
    mocks.archive.mockResolvedValue(undefined);
    mocks.archiveMany.mockResolvedValue(undefined);
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
        kind: 'actionable',
        sessionId: 'session-1',
        createdAt: '2026-07-16T10:00:00.000Z',
        readAt: null,
        actedAt: null,
        archivedAt: null,
        expiresAt: null,
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

  it('结果播报不占用铃铛：红点不亮、待处理列表不展示', async () => {
    currentNotifications = [];
    currentBroadcasts = [
      {
        id: 'notif-task',
        title: '任务已完成 · build',
        body: '构建完成',
        eventType: 'task_update',
        kind: 'informational',
        sessionId: 'session-1',
        createdAt: '2026-07-16T10:00:00.000Z',
        readAt: null,
        actedAt: null,
        archivedAt: null,
        expiresAt: null,
        status: 'unread',
      },
    ];

    render(<NotificationCenter accessToken="token-test" gatewayUrl="https://gateway.test" />);

    const trigger = await screen.findByTitle('通知中心');
    fireEvent.click(trigger);

    // 空态要解释被折叠的结果播报去了哪，否则看起来像消息丢了。
    await screen.findByText('没有待处理的请求');
    expect(screen.getByText(/1 条任务结果已折叠/)).toBeTruthy();
    expect(screen.queryByText('任务已完成 · build')).toBeNull();
    expect(trigger.textContent).not.toMatch(/1/);
  });

  it('切到「全部」后结果播报可回溯', async () => {
    currentArchiveView = [
      {
        id: 'notif-task',
        title: '任务已完成 · build',
        body: '构建完成',
        eventType: 'task_update',
        kind: 'informational',
        sessionId: 'session-1',
        createdAt: '2026-07-16T10:00:00.000Z',
        readAt: null,
        actedAt: null,
        archivedAt: null,
        expiresAt: null,
        status: 'unread',
      },
    ];

    render(<NotificationCenter accessToken="token-test" gatewayUrl="https://gateway.test" />);

    const trigger = await screen.findByTitle('通知中心');
    fireEvent.click(trigger);

    fireEvent.click(await screen.findByRole('tab', { name: '全部' }));

    await screen.findByText('任务已完成 · build');
  });

  it('忽略通知会立刻同步递减红点（不等下一轮轮询）', async () => {
    render(<NotificationCenter accessToken="token-test" gatewayUrl="https://gateway.test" />);

    const trigger = await screen.findByTitle('通知中心');
    fireEvent.click(trigger);

    const archiveButton = await screen.findByRole('button', { name: '忽略' });
    fireEvent.click(archiveButton);

    await waitFor(() => {
      expect(mocks.archive).toHaveBeenCalledWith('token-test', 'notif-1');
    });
    await waitFor(() => {
      expect(trigger.textContent).not.toMatch(/1/);
    });
    expect(mocks.toast).toHaveBeenCalledWith('已忽略，可在「已归档」中找回', 'info');
  });

  it('忽略此会话会走批量归档接口', async () => {
    render(<NotificationCenter accessToken="token-test" gatewayUrl="https://gateway.test" />);

    const trigger = await screen.findByTitle('通知中心');
    fireEvent.click(trigger);

    const archiveSessionButton = await screen.findByRole('button', { name: '忽略此会话' });
    fireEvent.click(archiveSessionButton);

    await waitFor(() => {
      expect(mocks.archiveMany).toHaveBeenCalledWith('token-test', { sessionId: 'session-1' });
    });
  });

  it('切换到已归档视图会带上对应 view 重新拉取', async () => {
    render(<NotificationCenter accessToken="token-test" gatewayUrl="https://gateway.test" />);

    const trigger = await screen.findByTitle('通知中心');
    fireEvent.click(trigger);

    const archivedTab = await screen.findByRole('tab', { name: '已归档' });
    fireEvent.click(archivedTab);

    await waitFor(() => {
      expect(mocks.listNotifications).toHaveBeenCalledWith(
        'token-test',
        expect.objectContaining({ view: 'archived' }),
      );
    });
  });
});
