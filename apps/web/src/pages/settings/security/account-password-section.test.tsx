// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const clientMocks = vi.hoisted(() => ({ changePassword: vi.fn() }));

vi.mock('@openAwork/web-client', () => ({
  changePassword: clientMocks.changePassword,
}));

import { AccountPasswordSection } from './account-password-section.js';
import { useAuthStore } from '../../../stores/auth/auth.js';

function fillForm(currentPassword: string, newPassword: string, confirmPassword: string): void {
  fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: currentPassword } });
  fireEvent.change(screen.getByLabelText('新密码'), { target: { value: newPassword } });
  fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: confirmPassword } });
}

beforeEach(() => {
  clientMocks.changePassword.mockReset();
  useAuthStore.setState({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    tokenExpiresAt: null,
    email: 'admin@openAwork.local',
    gatewayUrl: 'http://localhost:3000',
    webAccessEnabled: false,
    webExposeLan: false,
    webPort: 3000,
  });
});

afterEach(() => {
  cleanup();
});

describe('AccountPasswordSection', () => {
  it('新密码不足 8 位时本地拦截，不发请求', () => {
    render(<AccountPasswordSection />);
    fillForm('old-password', 'short', 'short');
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }));

    expect(screen.getByRole('alert').textContent).toContain('至少 8 位');
    expect(clientMocks.changePassword).not.toHaveBeenCalled();
  });

  it('两次输入不一致时本地拦截，不发请求', () => {
    render(<AccountPasswordSection />);
    fillForm('old-password', 'new-password-123', 'new-password-456');
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }));

    expect(screen.getByRole('alert').textContent).toContain('不一致');
    expect(clientMocks.changePassword).not.toHaveBeenCalled();
  });

  it('改密成功后用服务端补发的新令牌覆盖登录态', async () => {
    clientMocks.changePassword.mockResolvedValue({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresIn: '15m',
    });

    render(<AccountPasswordSection />);
    fillForm('old-password', 'new-password-123', 'new-password-123');
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }));

    await waitFor(() => {
      expect(useAuthStore.getState().accessToken).toBe('new-access');
    });
    // 服务端作废了旧 refresh token，本地必须同步换成新的一对，否则会话无法续期。
    expect(useAuthStore.getState().refreshToken).toBe('new-refresh');
    expect(clientMocks.changePassword).toHaveBeenCalledWith(
      'http://localhost:3000',
      'access-token',
      'old-password',
      'new-password-123',
    );
    expect(screen.getByRole('status').textContent).toContain('桌面端与 Web 端同时生效');
  });

  it('服务端拒绝时展示服务端文案', async () => {
    clientMocks.changePassword.mockRejectedValue(new Error('当前密码不正确。'));

    render(<AccountPasswordSection />);
    fillForm('wrong-password', 'new-password-123', 'new-password-123');
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('当前密码不正确。');
    });
  });
});
