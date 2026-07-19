import { expect, test, type Page } from '@playwright/test';

const SESSION_ID = 'session-desktop-demo';
const GATEWAY_URL = 'http://mock-gateway.invalid';
const NOW = 1_784_368_800_000;
const DESKTOP_LAYOUT_E2E_TIMEOUT_MS = 60_000;

test.setTimeout(DESKTOP_LAYOUT_E2E_TIMEOUT_MS);

const SESSION_FIXTURE = {
  id: SESSION_ID,
  title: 'Desktop Fusion Layout Verification',
  createdAt: NOW,
  updatedAt: NOW,
  parentSessionId: null,
  team_parent_session_id: null,
  state_status: 'idle',
  role_layer: null,
  substate: null,
  messages: [],
  metadata_json: '{}',
  runEvents: [],
  todos: [],
};

async function installDesktopGatewayMocks(page: Page): Promise<void> {
  await page.route(`${GATEWAY_URL}/**`, async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });

    switch (url.pathname) {
      case '/notifications':
        return json([]);
      case '/notifications/preferences':
        return json({ desktop: true, email: false });
      case '/sessions':
        return json({ sessions: [] });
      case `/sessions/${SESSION_ID}`:
        return json({ session: SESSION_FIXTURE });
      case `/sessions/${SESSION_ID}/recovery`:
        return json({
          recovery: {
            activeStream: null,
            children: [],
            pendingPermissions: [],
            pendingQuestions: [],
            ratings: [],
            session: SESSION_FIXTURE,
            tasks: [],
            todoLanes: {
              main: [],
              temp: [],
            },
            totalMessageCount: 0,
            totalTurnCount: 0,
          },
        });
      case `/sessions/${SESSION_ID}/artifacts`:
        return json({ contentArtifacts: [] });
      case `/sessions/${SESSION_ID}/terminals`:
        return json({ terminals: [] });
      case '/sessions/search':
        return json({ results: [] });
      case '/team/runtime':
        return json({ sessions: [], workspaces: [], events: [] });
      case '/team/workspaces':
        return json([]);
      case '/commands':
        return json({ commands: [] });
      case '/settings/profile':
        return json({ displayName: 'Tester' });
      case '/settings/companion':
        return json({
          preferences: {
            enabled: true,
            voiceOutputEnabled: false,
          },
          bindings: {},
          profile: null,
          feature: {
            enabled: true,
            mode: 'beta',
          },
        });
      case '/settings/model-prices':
        return json([]);
      case '/settings/plugins':
        return json([]);
      case '/settings/providers':
        return json([]);
      case '/settings/telemetry/consent':
        return json({ granted: false });
      case '/capabilities':
        return json({ capabilities: [] });
      default:
        return json({});
    }
  });
}

async function seedDesktopStorage(page: Page, layoutMode: 'classic' | 'fusion'): Promise<void> {
  await page.addInitScript(
    ({
      gatewayUrl,
      layoutMode: nextLayoutMode,
    }: {
      gatewayUrl: string;
      layoutMode: 'classic' | 'fusion';
    }) => {
      localStorage.setItem('onboarded', '1');
      localStorage.setItem('telemetry_consent_shown', '1');
      localStorage.setItem('telemetry_consent', 'declined');
      localStorage.setItem('desktop_gateway_mode', 'remote');
      localStorage.setItem(
        'auth-store',
        JSON.stringify({
          state: {
            accessToken: 'desktop-token',
            refreshToken: null,
            tokenExpiresAt: Date.now() + 60 * 60 * 1000,
            email: 'desktop@example.com',
            gatewayUrl,
            webAccessEnabled: false,
            webPort: 3000,
            webExposeLan: false,
          },
          version: 0,
        }),
      );
      localStorage.setItem(
        'openAwork-ui-state',
        JSON.stringify({
          state: {
            workbenchLayoutMode: nextLayoutMode,
            editorMode: false,
            editorFullScreen: false,
          },
          version: 20,
        }),
      );
    },
    {
      gatewayUrl: GATEWAY_URL,
      layoutMode,
    },
  );
}

async function openDesktopChat(page: Page, layoutMode: 'classic' | 'fusion'): Promise<void> {
  await installDesktopGatewayMocks(page);
  await seedDesktopStorage(page, layoutMode);
  await page.goto(`/chat/${SESSION_ID}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('OpenAWork').first()).toBeVisible();
  await expect(page.getByLabel('Sessions')).toBeVisible();
  await expect(page.locator('.page-root')).toBeVisible();
}

test('desktop app renders Fusion chat layout inside desktop shell', async ({ page }) => {
  await openDesktopChat(page, 'fusion');

  await expect(page.locator('.page-root.page-root-fusion-col')).toBeVisible();
  await expect(page.getByTestId('fusion-chat-main-shell')).toBeVisible();
  await expect(page.getByText('Gateway ready · mock-gateway.invalid')).toBeVisible();
});

test('desktop app preserves Classic chat fallback when layout mode switches back', async ({
  page,
}) => {
  await openDesktopChat(page, 'classic');

  await expect(page.locator('.page-root.page-root-row')).toBeVisible();
  await expect(page.getByTestId('fusion-chat-main-shell')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '打开快捷终端面板' })).toBeVisible();
});
