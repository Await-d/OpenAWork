// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { login } from '@openAwork/web-client';
import LoginPage from './LoginPage.js';
import { preloadRouteModuleByPath } from '../routes/preloadable-route-modules.js';
import { useAuthStore } from '../stores/auth.js';

const { loginMock } = vi.hoisted(() => ({
  loginMock: vi.fn(async () => ({
    accessToken: 'token-123',
    refreshToken: 'refresh-123',
    expiresIn: 3600,
  })),
}));

vi.mock('@openAwork/web-client', () => ({
  login: loginMock,
  refreshAccessToken: vi.fn(async () => ({
    accessToken: 'token-123',
    refreshToken: 'refresh-123',
    expiresIn: 3600,
  })),
}));

vi.mock('../routes/preloadable-route-modules.js', () => ({
  preloadRouteModuleByPath: vi.fn(() => null),
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  useAuthStore.setState({
    accessToken: null,
    refreshToken: null,
    tokenExpiresAt: null,
    email: null,
    gatewayUrl: 'http://localhost:3000',
    webAccessEnabled: false,
    webPort: 3000,
  });

  vi.mocked(login).mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }

  root = null;
  container?.remove();
  container = null;
  vi.restoreAllMocks();
});

async function renderLoginPage() {
  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<LoginPage />} />
          <Route path="/chat" element={<div data-testid="chat-route">chat route</div>} />
        </Routes>
      </MemoryRouter>,
    );
  });

  return container!;
}

describe('LoginPage route preloading', () => {
  it('preloads chat before navigating after a successful login', async () => {
    const rendered = await renderLoginPage();
    const emailInput = rendered.querySelector('input[type="email"]') as HTMLInputElement | null;
    const passwordInput = rendered.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement | null;
    const submitButton = rendered.querySelector('button[type="submit"]');

    act(() => {
      const emailSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      emailSetter?.call(emailInput, 'demo@openawork.local');
      emailInput?.dispatchEvent(new Event('input', { bubbles: true }));

      const passwordSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      passwordSetter?.call(passwordInput, 'secret-123');
      passwordInput?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(login).toHaveBeenCalledWith(
      'http://localhost:3000',
      'demo@openawork.local',
      'secret-123',
    );
    expect(preloadRouteModuleByPath).toHaveBeenCalledWith('/chat');
    expect(rendered.querySelector('[data-testid="chat-route"]')).not.toBeNull();
  });
});
