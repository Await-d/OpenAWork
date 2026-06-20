// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FloatingPermissionPrompt } from './FloatingPermissionPrompt.js';

const mocks = vi.hoisted(() => ({
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

vi.mock('../../stores/auth/auth.js', () => ({
  useAuthStore: (
    selector?: (state: { accessToken: string; gatewayUrl: string }) => unknown,
  ) => {
    const authState = {
      accessToken: 'token-test',
      gatewayUrl: 'https://gateway.test',
    };
    return typeof selector === 'function' ? selector(authState) : authState;
  },
}));

vi.mock('../../utils/session/session-list-events.js', () => ({
  requestCurrentSessionRefresh: mocks.requestCurrentSessionRefresh,
  requestSessionListRefresh: mocks.requestSessionListRefresh,
  subscribeSessionPendingPermission: mocks.subscribeSessionPendingPermission,
}));

vi.mock('../../utils/permission/permission-reply.js', () => ({
  replyPermissionRequest: mocks.replyPermissionRequest,
}));

vi.mock('../common/feedback/ToastNotification.js', () => ({
  toast: mocks.toast,
}));

vi.mock('@openAwork/web-client', () => ({
  createSessionsClient: () => ({
    get: mocks.sessionsClientGet,
  }),
}));

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
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
});
