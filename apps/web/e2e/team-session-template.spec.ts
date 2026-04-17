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

async function mockTeamTemplateSessionFlow(page: Page): Promise<{
  getCreateSessionPayload: () => Record<string, unknown> | null;
}> {
  const workspace = {
    id: 'workspace-1',
    name: '研究工作区',
    description: 'saved-template-e2e',
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
    {
      id: 'atlas',
      label: 'Atlas',
      description: 'reviewer',
      aliases: [],
      canonicalRole: { coreRole: 'reviewer', confidence: 'medium' },
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
  const template = {
    id: 'workflow-1',
    name: '研究团队模板',
    description: '预填完整绑定',
    category: 'team-playbook',
    metadata: {
      teamTemplate: {
        defaultBindings: {
          planner: 'oracle',
          researcher: 'librarian',
          executor: 'hephaestus',
          reviewer: 'momus',
        },
        defaultProvider: 'claude-code',
        optionalAgentIds: ['atlas'],
        requiredRoles: ['planner', 'researcher', 'executor', 'reviewer'],
      },
    },
    nodes: [],
    edges: [],
  };

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
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify([workspace]) });
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
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify([template]) });
      return;
    }

    if (pathname === '/team/workspaces/workspace-1/sessions') {
      const sessionPayload = JSON.parse(request.postData() || '{}') as Record<string, unknown>;
      createSessionPayload = sessionPayload;
      createdSession = {
        id: 'team-session-created-2',
        title: String(sessionPayload['title']),
        state_status: 'idle',
        metadata_json: JSON.stringify({
          teamWorkspaceId: 'workspace-1',
          teamDefinition: {
            source: sessionPayload['source'],
            requiredRoleBindings: [
              { role: 'planner', agentId: 'oracle' },
              { role: 'researcher', agentId: 'librarian' },
              { role: 'executor', agentId: 'hephaestus' },
              { role: 'reviewer', agentId: 'momus' },
            ],
            optionalMembers: Array.isArray(sessionPayload['optionalAgentIds'])
              ? sessionPayload['optionalAgentIds'].map((agentId: string) => ({ agentId }))
              : [],
            defaultProvider:
              typeof sessionPayload['defaultProvider'] === 'string'
                ? sessionPayload['defaultProvider']
                : null,
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
  };
}

test.describe('Team saved template -> create session', () => {
  test('Given a saved template When creating a team session Then prefill bindings and submit template source payload', async ({
    page,
  }) => {
    await primeAuthenticatedSession(page);
    const mocks = await mockTeamTemplateSessionFlow(page);

    await page.goto('/team/workspace-1');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: '新建会话' }).click();

    const templateButton = page.locator('button').filter({ hasText: '研究团队模板' }).last();
    await templateButton.click();
    await page.getByRole('button', { name: '下一步' }).click();

    await expect(page.getByText('该核心角色使用系统固定 agent，用户不可修改。')).toHaveCount(4);
    await expect(page.getByText('oracle')).toBeVisible();
    await expect(page.getByText('librarian')).toBeVisible();
    await expect(page.getByText('hephaestus')).toBeVisible();
    await expect(page.getByText('momus')).toBeVisible();

    await page.locator('#new-team-session-title').fill('模板团队会话');
    await page.getByRole('button', { name: '下一步' }).click();
    await expect(page.getByText('Atlas')).toBeVisible();

    await page.getByRole('button', { name: '下一步' }).click();
    await page.getByRole('button', { name: '确认创建' }).click();

    await expect.poll(() => mocks.getCreateSessionPayload()).not.toBeNull();

    expect(mocks.getCreateSessionPayload()).toMatchObject({
      title: '模板团队会话',
      source: { kind: 'saved-template', templateId: 'workflow-1' },
      optionalAgentIds: ['atlas'],
      defaultProvider: 'claude-code',
    });
    expect(mocks.getCreateSessionPayload()?.requiredRoleBindings).toBeUndefined();

    await expect(page.getByText('模板团队会话')).toBeVisible();
  });
});
