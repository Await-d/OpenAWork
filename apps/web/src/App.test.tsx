// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Outlet } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from './stores/auth.js';

vi.mock('./components/Layout.js', () => ({
  default: function MockLayout() {
    return <Outlet />;
  },
}));

vi.mock('./components/OnboardingModal.js', () => ({
  default: () => null,
}));

vi.mock('./components/ToastNotification.js', () => ({
  ToastContainer: () => null,
}));

vi.mock('./components/UpdateBanner.js', () => ({
  default: () => null,
}));

vi.mock('./components/SplashScreen.js', () => ({
  default: () => null,
}));

vi.mock('@openAwork/shared-ui', async () => {
  const actual =
    await vi.importActual<typeof import('@openAwork/shared-ui')>('@openAwork/shared-ui');
  return {
    ...actual,
    TelemetryConsentModal: () => null,
  };
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  useAuthStore.setState({ accessToken: 'token-123', gatewayUrl: 'http://localhost:3000' });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      media: '(prefers-color-scheme: light)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const rawUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(rawUrl, 'http://localhost:3000');

      if (url.pathname.endsWith('/channels')) {
        return {
          ok: true,
          json: async () => ({ channels: [] }),
        } as Response;
      }

      if (url.pathname.endsWith('/channels/descriptors')) {
        return {
          ok: true,
          json: async () => ({ descriptors: [] }),
        } as Response;
      }

      if (url.pathname.endsWith('/agents')) {
        return {
          ok: true,
          json: async () => ({
            agents: [
              {
                id: 'oracle',
                origin: 'builtin',
                source: 'reference',
                enabled: true,
                removable: false,
                resettable: false,
                hasOverrides: false,
                createdAt: '1970-01-01T00:00:00.000Z',
                updatedAt: '1970-01-01T00:00:00.000Z',
                label: 'oracle',
                description: '只读顾问 agent',
                aliases: ['architect'],
                canonicalRole: { coreRole: 'planner', preset: 'architect', confidence: 'medium' },
              },
            ],
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({
          records: [],
          budgetUsd: 10,
          channels: [],
          servers: [],
          diagnostics: [],
          models: [],
          decisions: [],
          logs: [],
          workers: [],
        }),
      } as Response;
    }),
  );

  vi.spyOn(useAuthStore.persist, 'hasHydrated').mockReturnValue(true);
  vi.spyOn(useAuthStore.persist, 'onFinishHydration').mockImplementation(() => () => undefined);

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
  vi.unstubAllGlobals();
});

async function waitForText(text: string, attempts = 12): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (container?.textContent?.includes(text)) {
      return;
    }

    await act(async () => {
      await vi.dynamicImportSettled();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  throw new Error(`Timed out waiting for text: ${text}`);
}

describe('App routing', () => {
  it('redirects /channels to the settings channels tab', async () => {
    const { default: App } = await import('./App.js');

    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/channels']}>
          <App />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitForText('渠道模板库');
    expect(container?.textContent).toContain('消息频道');
    expect(container?.textContent).toContain('渠道模板库');
  });

  it('renders the agents page on /agents', async () => {
    const { default: App } = await import('./App.js');

    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/agents']}>
          <App />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitForText('oracle');
    expect(container?.textContent).toContain('Agent 管理');
    expect(container?.textContent).toContain('oracle');
  });
});
