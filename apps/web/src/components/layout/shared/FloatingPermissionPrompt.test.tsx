// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FloatingPermissionPrompt } from './FloatingPermissionPrompt.js';

const mocks = vi.hoisted(() => ({
  createNotificationsList: vi.fn(),
  createPermissionsListPending: vi.fn(),
  getSessionPendingInteractionSnapshot: vi.fn(() => ({
    pendingPermissionBySession: new Map(),
    pendingQuestionBySession: new Map(),
  })),
  navigate: vi.fn(),
  subscribeSessionPendingPermission: vi.fn(),
  requestCurrentSessionRefresh: vi.fn(),
  requestSessionListRefresh: vi.fn(),
  replyPermissionRequest: vi.fn(async () => undefined),
  toast: vi.fn(),
  sessionsClientGet: vi.fn(),
}));

vi.mock('react-router', () => ({
  useLocation: () => ({ pathname: '/chat/current-chat-session' }),
  useNavigate: () => mocks.navigate,
}));

vi.mock('../../../stores/auth/auth.js', () => ({
  useAuthStore: (selector?: (state: { accessToken: string; gatewayUrl: string }) => unknown) => {
    const authState = {
      accessToken: 'token-test',
      gatewayUrl: 'https://gateway.test',
    };
    return typeof selector === 'function' ? selector(authState) : authState;
  },
}));

vi.mock('../../../utils/session/session-list-events.js', () => ({
  getSessionPendingInteractionSnapshot: mocks.getSessionPendingInteractionSnapshot,
  requestCurrentSessionRefresh: mocks.requestCurrentSessionRefresh,
  requestSessionListRefresh: mocks.requestSessionListRefresh,
  subscribeSessionPendingPermission: mocks.subscribeSessionPendingPermission,
}));

vi.mock('../../../utils/permission/permission-reply.js', () => ({
  replyPermissionRequest: mocks.replyPermissionRequest,
}));

vi.mock('../../common/feedback/ToastNotification.js', () => ({
  toast: mocks.toast,
}));

vi.mock('@openAwork/web-client', () => ({
  createNotificationsClient: () => ({
    list: mocks.createNotificationsList,
  }),
  createPermissionsClient: () => ({
    listPending: mocks.createPermissionsListPending,
  }),
  createSessionsClient: () => ({
    get: mocks.sessionsClientGet,
  }),
}));

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.createNotificationsList.mockResolvedValue([]);
  mocks.createPermissionsListPending.mockResolvedValue([]);
  mocks.subscribeSessionPendingPermission.mockImplementation((onChange) => {
    onChange('target-session-1', {
      requestId: 'perm-1',
      targetSessionId: 'target-session-1',
      toolName: 'bash',
      scope: 'bash pwd',
      reason: '读取目录',
      riskLevel: 'low',
      previewAction: 'bash pwd',
    });
    return () => undefined;
  });
});

afterEach(() => {
  cleanup();
});

describe('FloatingPermissionPrompt', () => {
  it('普通 chat 会话仍跳转到 /chat/:sessionId', async () => {
    mocks.sessionsClientGet.mockResolvedValue({
      id: 'target-session-1',
      title: '普通会话',
      role_layer: null,
      metadata_json: '{}',
    });

    render(<FloatingPermissionPrompt />);

    const sessionButton = await screen.findByRole('button', { name: '普通会话' });
    fireEvent.click(sessionButton);

    expect(mocks.navigate).toHaveBeenCalledWith('/chat/target-session-1');
  });

  it('team 会话会跳转到所属工作区而不是 /chat/:sessionId', async () => {
    mocks.sessionsClientGet.mockResolvedValue({
      id: 'target-session-1',
      title: '执行层会话',
      role_layer: 'executor',
      metadata_json: JSON.stringify({ teamWorkspaceId: 'workspace-1' }),
    });

    render(<FloatingPermissionPrompt />);

    const sessionButton = await screen.findByRole('button', { name: '执行层会话' });
    fireEvent.click(sessionButton);

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith('/team/workspace-1?sessionId=target-session-1');
    });
  });

  it('错过实时事件时会从未读通知恢复待审批弹层', async () => {
    mocks.subscribeSessionPendingPermission.mockImplementation(() => () => undefined);
    mocks.createNotificationsList.mockResolvedValue([
      {
        id: 'notif-1',
        title: '等待权限 · write',
        body: 'requestId=perm-2\n写入工作区文件\nwrite /tmp/demo.md\nwrite:workspace\nhigh',
        eventType: 'permission_asked',
        sessionId: 'target-session-2',
        status: 'unread',
        readAt: null,
        createdAt: '2026-07-16T07:30:45.000Z',
      },
    ]);
    mocks.createPermissionsListPending.mockResolvedValue([
      {
        requestId: 'perm-2',
        sessionId: 'target-session-2',
        toolName: 'write',
        scope: 'write:workspace',
        reason: '写入工作区文件',
        riskLevel: 'high',
        previewAction: 'write /tmp/demo.md',
        status: 'pending',
        createdAt: '2026-07-16T07:30:45.000Z',
      },
    ]);
    mocks.sessionsClientGet.mockResolvedValue({
      id: 'target-session-2',
      title: '恢复出来的审批',
      role_layer: null,
      metadata_json: '{}',
    });

    render(<FloatingPermissionPrompt />);

    expect(await screen.findByText('write')).toBeTruthy();
    expect(await screen.findByRole('button', { name: '恢复出来的审批' })).toBeTruthy();
    await waitFor(() => {
      expect(mocks.createNotificationsList).toHaveBeenCalledWith('token-test', {
        limit: 20,
        status: 'unread',
      });
    });
    expect(mocks.createPermissionsListPending).toHaveBeenCalledWith(
      'token-test',
      'target-session-2',
    );
  });
});
