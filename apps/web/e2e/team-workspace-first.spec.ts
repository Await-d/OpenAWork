import { expect, test, type Page } from '@playwright/test';

const GATEWAY_URL = 'http://localhost:3000';

async function primeAuthenticatedSession(page: Page): Promise<void> {
  await page.addInitScript(
    ({ gatewayUrl }) => {
      localStorage.setItem(
        'auth-store',
        JSON.stringify({
          state: {
            accessToken: 'token-123',
            refreshToken: 'refresh-123',
            tokenExpiresAt: Date.now() + 60 * 60 * 1000,
            email: 'tester@openawork.local',
            gatewayUrl,
            webAccessEnabled: false,
            webPort: 3000,
          },
          version: 0,
        }),
      );
      localStorage.setItem('onboarded', '1');
      localStorage.setItem('telemetry_consent_shown', '1');
    },
    { gatewayUrl: GATEWAY_URL },
  );
}

async function mockWorkspaceFirstFlow(page: Page): Promise<{
  getCreateSessionPayload: () => Record<string, unknown> | null;
  getCreateWorkspacePayload: () => Record<string, unknown> | null;
}> {
  const workspace = {
    id: 'workspace-1',
    name: '研究工作区',
    description: null,
    visibility: 'private',
    defaultWorkingRoot: '/workspace/team-a',
    createdByUserId: 'user-1',
    createdAt: '2026-04-16T00:00:00.000Z',
    updatedAt: '2026-04-16T00:00:00.000Z',
  };
  const agents = [
    {
      id: 'oracle',
      label: 'Oracle',
      description: 'planner',
      aliases: [],
      canonicalRole: { coreRole: 'planner', confidence: 'high' },
      origin: 'builtin',
      source: 'builtin',
      enabled: true,
      removable: false,
      resettable: false,
      hasOverrides: false,
      createdAt: '2026-04-16T00:00:00.000Z',
      updatedAt: '2026-04-16T00:00:00.000Z',
    },
    {
      id: 'librarian',
      label: 'Librarian',
      description: 'researcher',
      aliases: [],
      canonicalRole: { coreRole: 'researcher', confidence: 'high' },
      origin: 'builtin',
      source: 'builtin',
      enabled: true,
      removable: false,
      resettable: false,
      hasOverrides: false,
      createdAt: '2026-04-16T00:00:00.000Z',
      updatedAt: '2026-04-16T00:00:00.000Z',
    },
    {
      id: 'hephaestus',
      label: 'Hephaestus',
      description: 'executor',
      aliases: [],
      canonicalRole: { coreRole: 'executor', confidence: 'high' },
      origin: 'builtin',
      source: 'builtin',
      enabled: true,
      removable: false,
      resettable: false,
      hasOverrides: false,
      createdAt: '2026-04-16T00:00:00.000Z',
      updatedAt: '2026-04-16T00:00:00.000Z',
    },
    {
      id: 'momus',
      label: 'Momus',
      description: 'reviewer',
      aliases: [],
      canonicalRole: { coreRole: 'reviewer', confidence: 'high' },
      origin: 'builtin',
      source: 'builtin',
      enabled: true,
      removable: false,
      resettable: false,
      hasOverrides: false,
      createdAt: '2026-04-16T00:00:00.000Z',
      updatedAt: '2026-04-16T00:00:00.000Z',
    },
  ];

  let workspaceCreated = false;
  let createWorkspacePayload: Record<string, unknown> | null = null;
  let createSessionPayload: Record<string, unknown> | null = null;
  let createdSession: {
    id: string;
    metadata_json: string;
    state_status: string;
    title: string;
  } | null = null;

  await page.route(`${GATEWAY_URL}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;

    if (pathname === '/agents') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ agents }) });
      return;
    }

    if (pathname === '/capabilities') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ capabilities: [] }),
      });
      return;
    }

    if (pathname === '/team/workspaces') {
      if (request.method() === 'POST') {
        createWorkspacePayload = JSON.parse(request.postData() || '{}');
        workspaceCreated = true;
        await route.fulfill({
          contentType: 'application/json',
          status: 201,
          body: JSON.stringify(workspace),
        });
        return;
      }

      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(workspaceCreated ? [workspace] : []),
      });
      return;
    }

    if (pathname === '/team/workspaces/workspace-1') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(workspace) });
      return;
    }

    if (pathname === '/team/workspaces/workspace-1/runtime') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          workspace,
          sessions: createdSession
            ? [
                {
                  id: createdSession.id,
                  metadataJson: createdSession.metadata_json,
                  parentSessionId: null,
                  title: createdSession.title,
                  updatedAt: '2026-04-16T00:30:00.000Z',
                  workspacePath: '/workspace/team-a',
                },
              ]
            : [],
          sharedSessions: [],
          sessionShares: [],
          runtimeTaskGroups: [],
        }),
      });
      return;
    }

    if (pathname === '/team/runtime') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          auditLogs: [],
          members: [],
          messages: [],
          runtimeTaskGroups: [],
          sessionShares: [],
          sharedSessions: [],
          sessions: createdSession
            ? [
                {
                  id: createdSession.id,
                  metadataJson: createdSession.metadata_json,
                  parentSessionId: null,
                  title: createdSession.title,
                  updatedAt: '2026-04-16T00:30:00.000Z',
                  workspacePath: '/workspace/team-a',
                },
              ]
            : [],
          tasks: [],
        }),
      });
      return;
    }

    if (pathname === '/workflows/templates') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify([]) });
      return;
    }

    if (pathname === '/team/workspaces/workspace-1/sessions') {
      const payload = JSON.parse(request.postData() || '{}') as Record<string, unknown>;
      createSessionPayload = payload;
      createdSession = {
        id: 'team-session-created-3',
        title: String(payload.title),
        state_status: 'idle',
        metadata_json: JSON.stringify({
          teamWorkspaceId: 'workspace-1',
          teamDefinition: {
            source: payload.source,
            requiredRoleBindings: [
              { role: 'planner', agentId: 'prometheus' },
              { role: 'researcher', agentId: 'librarian' },
              { role: 'executor', agentId: 'hephaestus' },
              { role: 'reviewer', agentId: 'momus' },
            ],
            optionalMembers: [],
            defaultProvider:
              typeof payload.defaultProvider === 'string' ? payload.defaultProvider : null,
          },
          workingDirectory: '/workspace/team-a',
        }),
      };
      await route.fulfill({
        contentType: 'application/json',
        status: 201,
        body: JSON.stringify(createdSession),
      });
      return;
    }

    if (
      pathname === '/commands' ||
      pathname === '/notifications/preferences' ||
      pathname === '/notifications' ||
      pathname === '/sessions'
    ) {
      const body =
        pathname === '/commands'
          ? { commands: [] }
          : pathname === '/sessions'
            ? { sessions: [] }
            : pathname === '/notifications/preferences'
              ? { enabled: false }
              : { notifications: [] };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: pathname }),
    });
  });

  return {
    getCreateSessionPayload: () => createSessionPayload,
    getCreateWorkspacePayload: () => createWorkspacePayload,
  };
}

test.describe('Team workspace-first create session', () => {
  test('Given no workspace When creating workspace first Then the user can create a team session from the new workspace', async ({
    page,
  }) => {
    await primeAuthenticatedSession(page);
    const mocks = await mockWorkspaceFirstFlow(page);

    await page.goto('/team');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('尚未创建团队工作空间')).toBeVisible();
    await page.getByRole('button', { name: '创建工作空间' }).click();
    await page.getByPlaceholder('工作空间名称').fill('研究工作区');
    await page.getByRole('button', { name: '创建' }).click();

    await expect.poll(() => mocks.getCreateWorkspacePayload()).not.toBeNull();
    expect(mocks.getCreateWorkspacePayload()).toMatchObject({ name: '研究工作区' });

    await expect(page).toHaveURL(/\/team\/workspace-1$/);
    await page.getByRole('button', { name: '新建会话' }).click();
    await page.getByRole('button', { name: '下一步' }).click();

    await page.locator('#new-team-session-title').fill('workspace-first 会话');
    await expect(page.getByText('该核心角色使用系统固定 agent，用户不可修改。')).toHaveCount(4);
    await page.getByRole('button', { name: '下一步' }).click();
    await page.getByRole('button', { name: '下一步' }).click();
    await page.getByRole('button', { name: '确认创建' }).click();

    await expect.poll(() => mocks.getCreateSessionPayload()).not.toBeNull();
    expect(mocks.getCreateSessionPayload()).toMatchObject({
      title: 'workspace-first 会话',
      source: { kind: 'blank' },
    });
    expect(mocks.getCreateSessionPayload()?.requiredRoleBindings).toBeUndefined();

    await expect(page.getByText('workspace-first 会话')).toBeVisible();
  });
});
