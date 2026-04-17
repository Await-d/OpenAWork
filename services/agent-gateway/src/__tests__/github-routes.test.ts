import { createHmac } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appendSessionMessageMock: vi.fn(),
  listSessionMessagesMock: vi.fn(),
  extractMessageTextMock: vi.fn(),
  runSessionInBackgroundMock: vi.fn(),
  sqliteGetMock: vi.fn(),
  sqliteRunMock: vi.fn(),
  sqliteAllMock: vi.fn(),
  octokitConstructorMock: vi.fn(),
  createAppAuthMock: vi.fn(),
}));

vi.mock('../auth.js', () => ({
  requireAuth: async (
    request: FastifyRequest & { user?: { sub: string; email: string } },
    reply: { status: (code: number) => { send: (payload: unknown) => void } },
  ) => {
    const authHeader = request.headers['authorization'];
    if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      reply.status(401).send({ error: 'Unauthorized' });
      return;
    }

    const userId = authHeader.slice('Bearer '.length);
    request.user = { sub: userId, email: `${userId}@example.com` };
  },
}));

vi.mock('../db.js', () => ({
  sqliteGet: mocks.sqliteGetMock,
  sqliteRun: mocks.sqliteRunMock,
  sqliteAll: mocks.sqliteAllMock,
}));

vi.mock('../request-workflow.js', () => ({
  startRequestWorkflow: vi.fn(() => ({
    step: {
      succeed: vi.fn(),
      fail: vi.fn(),
    },
  })),
}));

vi.mock('../message-v2-adapter.js', () => ({
  appendSessionMessageV2: mocks.appendSessionMessageMock,
  listSessionMessagesV2: mocks.listSessionMessagesMock,
}));

vi.mock('../session-message-store.js', () => ({
  extractMessageText: mocks.extractMessageTextMock,
}));

vi.mock('../routes/stream-runtime.js', () => ({
  runSessionInBackground: mocks.runSessionInBackgroundMock,
}));

vi.mock('@octokit/rest', () => ({
  Octokit: mocks.octokitConstructorMock,
}));

vi.mock('@octokit/auth-app', () => ({
  createAppAuth: mocks.createAppAuthMock,
}));

function signPayload(secret: string, payload: string): string {
  return `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
}

describe('github routes', () => {
  let app: Awaited<ReturnType<typeof Fastify>>;

  beforeEach(async () => {
    vi.resetModules();
    mocks.appendSessionMessageMock.mockReset();
    mocks.listSessionMessagesMock.mockReset();
    mocks.extractMessageTextMock.mockReset();
    mocks.runSessionInBackgroundMock.mockReset();
    mocks.sqliteGetMock.mockReset();
    mocks.sqliteRunMock.mockReset();
    mocks.sqliteAllMock.mockReset();
    mocks.octokitConstructorMock.mockReset();
    mocks.createAppAuthMock.mockReset();
    mocks.runSessionInBackgroundMock.mockResolvedValue({ statusCode: 202 });
    mocks.sqliteAllMock.mockReturnValue([]);
    mocks.listSessionMessagesMock.mockReturnValue([]);
    mocks.extractMessageTextMock.mockReturnValue('');
    mocks.sqliteGetMock.mockImplementation((query: string, params?: unknown[]) => {
      if (query.includes('SELECT id FROM users WHERE id = ? LIMIT 1')) {
        const [userId] = (params ?? []) as [string];
        if (userId === 'missing-user') {
          return undefined;
        }
        return { id: userId };
      }
      return undefined;
    });

    const { githubRoutes } = await import('../github/router.js');
    app = Fastify();
    app.decorateRequest('user', null);
    await app.register(githubRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('stores trigger ownership and only lists triggers for the authenticated user', async () => {
    const payload = {
      appId: 'app-1',
      privateKeyPem: 'pem',
      webhookSecretForHmacVerification: 'secret-a',
      repoFullNameOwnerSlashRepo: 'acme/repo-a',
      events: ['push'],
      agentPromptTemplate: 'Handle {{repo}} {{event}}',
      autoApproveWithoutUserConfirmation: false,
    };

    const createResponse = await app.inject({
      method: 'POST',
      url: '/github/triggers',
      headers: { authorization: 'Bearer user-a' },
      payload,
    });

    expect(createResponse.statusCode).toBe(201);

    await app.inject({
      method: 'POST',
      url: '/github/triggers',
      headers: { authorization: 'Bearer user-b' },
      payload: {
        ...payload,
        webhookSecretForHmacVerification: 'secret-b',
        repoFullNameOwnerSlashRepo: 'acme/repo-b',
      },
    });

    const userAList = await app.inject({
      method: 'GET',
      url: '/github/triggers',
      headers: { authorization: 'Bearer user-a' },
    });
    const userBList = await app.inject({
      method: 'GET',
      url: '/github/triggers',
      headers: { authorization: 'Bearer user-b' },
    });

    expect(userAList.statusCode).toBe(200);
    expect(userBList.statusCode).toBe(200);
    expect(JSON.parse(userAList.body)).toEqual({
      triggers: [{ repo: 'acme/repo-a', events: ['push'] }],
    });
    expect(JSON.parse(userBList.body)).toEqual({
      triggers: [{ repo: 'acme/repo-b', events: ['push'] }],
    });
  });

  it('creates a user-owned session and starts background stream execution for webhook matches', async () => {
    await app.inject({
      method: 'POST',
      url: '/github/triggers',
      headers: { authorization: 'Bearer user-a' },
      payload: {
        appId: 'app-1',
        privateKeyPem: 'pem',
        webhookSecretForHmacVerification: 'secret-a',
        repoFullNameOwnerSlashRepo: 'acme/repo',
        events: ['push'],
        agentPromptTemplate: 'Handle {{repo}} via {{event}}',
        autoApproveWithoutUserConfirmation: true,
      },
    });

    const webhookBody = JSON.stringify({
      ref: 'refs/heads/main',
      repository: { full_name: 'acme/repo' },
      commits: [],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/github/webhook',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'push',
        'x-hub-signature-256': signPayload('secret-a', webhookBody),
      },
      payload: JSON.parse(webhookBody),
    });

    expect(response.statusCode).toBe(202);
    const body = JSON.parse(response.body) as { ok: boolean; handled: boolean; sessionId: string };
    expect(body.ok).toBe(true);
    expect(body.handled).toBe(true);
    expect(body.sessionId).toBeTruthy();

    expect(mocks.sqliteRunMock).toHaveBeenCalledWith(
      'INSERT INTO sessions (id, user_id, title, messages_json, state_status, metadata_json) VALUES (?, ?, ?, ?, ?, ?)',
      [
        expect.any(String),
        'user-a',
        'GitHub: push on acme/repo',
        '[]',
        'idle',
        JSON.stringify({ githubTrigger: { eventType: 'push', repoFullName: 'acme/repo' } }),
      ],
    );
    expect(mocks.runSessionInBackgroundMock).toHaveBeenCalledWith({
      requestData: {
        clientRequestId: expect.any(String),
        displayMessage: 'Handle acme/repo via push',
        message: 'Handle acme/repo via push',
        yoloMode: true,
      },
      sessionId: body.sessionId,
      userId: 'user-a',
    });
  });

  it('verifies webhook signatures against the original raw request body bytes', async () => {
    await app.inject({
      method: 'POST',
      url: '/github/triggers',
      headers: { authorization: 'Bearer user-a' },
      payload: {
        appId: 'app-1',
        privateKeyPem: 'pem',
        webhookSecretForHmacVerification: 'secret-a',
        repoFullNameOwnerSlashRepo: 'acme/repo',
        events: ['push'],
        agentPromptTemplate: 'Handle {{repo}} via {{event}}',
        autoApproveWithoutUserConfirmation: false,
      },
    });

    const webhookBody = JSON.stringify(
      {
        ref: 'refs/heads/main',
        repository: { full_name: 'acme/repo' },
        commits: [],
      },
      null,
      2,
    );

    const response = await app.inject({
      method: 'POST',
      url: '/github/webhook',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'push',
        'x-hub-signature-256': signPayload('secret-a', webhookBody),
      },
      payload: webhookBody,
    });

    expect(response.statusCode).toBe(202);
    expect(mocks.runSessionInBackgroundMock).toHaveBeenCalledWith({
      requestData: {
        clientRequestId: expect.any(String),
        displayMessage: 'Handle acme/repo via push',
        message: 'Handle acme/repo via push',
        yoloMode: false,
      },
      sessionId: expect.any(String),
      userId: 'user-a',
    });
  });

  it('fails safely when the registered owner cannot be resolved at webhook execution time', async () => {
    await app.inject({
      method: 'POST',
      url: '/github/triggers',
      headers: { authorization: 'Bearer missing-user' },
      payload: {
        appId: 'app-1',
        privateKeyPem: 'pem',
        webhookSecretForHmacVerification: 'secret-missing',
        repoFullNameOwnerSlashRepo: 'acme/missing',
        events: ['push'],
        agentPromptTemplate: 'Handle {{repo}}',
        autoApproveWithoutUserConfirmation: false,
      },
    });

    const webhookBody = JSON.stringify({
      ref: 'refs/heads/main',
      repository: { full_name: 'acme/missing' },
      commits: [],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/github/webhook',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'push',
        'x-hub-signature-256': signPayload('secret-missing', webhookBody),
      },
      payload: JSON.parse(webhookBody),
    });

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual({ error: 'GitHub trigger owner not found' });
    expect(mocks.runSessionInBackgroundMock).not.toHaveBeenCalled();
  });

  it('persists trigger config to user_settings on registration', async () => {
    const payload = {
      appId: 'app-1',
      privateKeyPem: 'pem',
      webhookSecretForHmacVerification: 'secret-a',
      repoFullNameOwnerSlashRepo: 'acme/repo-persist',
      events: ['push'],
      agentPromptTemplate: 'Handle {{repo}}',
      autoApproveWithoutUserConfirmation: false,
    };

    await app.inject({
      method: 'POST',
      url: '/github/triggers',
      headers: { authorization: 'Bearer user-persist' },
      payload,
    });

    const upsertCalls = mocks.sqliteRunMock.mock.calls.filter((call: unknown[]) => {
      if (typeof call[0] !== 'string') return false;
      const query = call[0] as string;
      if (!query.includes('INSERT INTO user_settings')) return false;
      const params = call[1] as unknown[] | undefined;
      return params?.some((p) => p === 'github_triggers');
    });
    expect(upsertCalls.length).toBe(1);

    const upsertParams = upsertCalls[0]?.[1] as unknown[];
    expect(upsertParams?.[0]).toBe('user-persist');
    expect(upsertParams?.[1]).toBe('github_triggers');

    const persistedValue = JSON.parse(upsertParams?.[2] as string) as unknown[];
    expect(persistedValue).toHaveLength(1);
    expect((persistedValue[0] as Record<string, unknown>)['repoFullNameOwnerSlashRepo']).toBe(
      'acme/repo-persist',
    );
  });

  it('restores triggers from user_settings on startup', async () => {
    const storedConfig = [
      {
        ownerUserId: 'user-restore',
        appId: 'app-restore',
        privateKeyPem: 'pem-restore',
        webhookSecretForHmacVerification: 'secret-restore',
        repoFullNameOwnerSlashRepo: 'acme/restored-repo',
        events: ['push'],
        agentPromptTemplate: 'Restored {{repo}}',
        autoApproveWithoutUserConfirmation: false,
      },
    ];
    mocks.sqliteAllMock.mockReturnValue([
      { user_id: 'user-restore', value: JSON.stringify(storedConfig) },
    ]);

    const { restoreGitHubTriggers } = await import('../github/router.js');
    restoreGitHubTriggers();

    const webhookBody = JSON.stringify({
      ref: 'refs/heads/main',
      repository: { full_name: 'acme/restored-repo' },
      commits: [],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/github/webhook',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'push',
        'x-hub-signature-256': signPayload('secret-restore', webhookBody),
      },
      payload: JSON.parse(webhookBody),
    });

    expect(response.statusCode).toBe(202);
    expect(mocks.runSessionInBackgroundMock).toHaveBeenCalled();
  });

  it('deletes a trigger by repo name', async () => {
    await app.inject({
      method: 'POST',
      url: '/github/triggers',
      headers: { authorization: 'Bearer user-del' },
      payload: {
        appId: 'app-del',
        privateKeyPem: 'pem',
        webhookSecretForHmacVerification: 'secret-del',
        repoFullNameOwnerSlashRepo: 'acme/to-delete',
        events: ['push'],
        agentPromptTemplate: 'Handle {{repo}}',
        autoApproveWithoutUserConfirmation: false,
      },
    });

    const listBefore = await app.inject({
      method: 'GET',
      url: '/github/triggers',
      headers: { authorization: 'Bearer user-del' },
    });
    expect(JSON.parse(listBefore.body).triggers).toHaveLength(1);

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/github/triggers/${encodeURIComponent('acme/to-delete')}`,
      headers: { authorization: 'Bearer user-del' },
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(JSON.parse(deleteResponse.body)).toEqual({ ok: true, repo: 'acme/to-delete' });

    const listAfter = await app.inject({
      method: 'GET',
      url: '/github/triggers',
      headers: { authorization: 'Bearer user-del' },
    });
    expect(JSON.parse(listAfter.body).triggers).toHaveLength(0);
  });

  it('returns 404 when deleting a non-existent trigger', async () => {
    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/github/triggers/${encodeURIComponent('acme/nonexistent')}`,
      headers: { authorization: 'Bearer user-del' },
    });

    expect(deleteResponse.statusCode).toBe(404);
  });

  it('attempts write-back after successful session execution for PR events', async () => {
    const mockCreateComment = vi.fn().mockResolvedValue({
      data: { id: 1, html_url: 'https://github.com/acme/writeback/issues/99#comment-1' },
    });
    let callCount = 0;
    mocks.octokitConstructorMock.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return {
          apps: {
            getRepoInstallation: vi.fn().mockResolvedValue({ data: { id: 42 } }),
          },
        };
      }
      return {
        issues: {
          createComment: mockCreateComment,
        },
      };
    });

    mocks.listSessionMessagesMock.mockReturnValue([
      {
        id: 'msg-1',
        role: 'assistant',
        createdAt: Date.now(),
        content: [{ type: 'text', text: 'PR分析完成，无问题' }],
      },
    ]);
    mocks.extractMessageTextMock.mockReturnValue('PR分析完成，无问题');

    await app.inject({
      method: 'POST',
      url: '/github/triggers',
      headers: { authorization: 'Bearer user-wb' },
      payload: {
        appId: 'app-wb',
        privateKeyPem: 'pem-wb',
        webhookSecretForHmacVerification: 'secret-wb',
        repoFullNameOwnerSlashRepo: 'acme/writeback',
        events: ['pull_request.opened'],
        agentPromptTemplate: 'Review PR #{{pr_number}}',
        autoApproveWithoutUserConfirmation: false,
      },
    });

    const webhookBody = JSON.stringify({
      action: 'opened',
      repository: { full_name: 'acme/writeback' },
      pull_request: {
        number: 99,
        title: 'Test PR',
        head: { sha: 'abc123', ref: 'feature' },
        base: { ref: 'main' },
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/github/webhook',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-hub-signature-256': signPayload('secret-wb', webhookBody),
      },
      payload: JSON.parse(webhookBody),
    });

    expect(response.statusCode).toBe(202);

    await vi.waitFor(
      () => {
        expect(mockCreateComment).toHaveBeenCalledWith({
          owner: 'acme',
          repo: 'writeback',
          issue_number: 99,
          body: 'PR分析完成，无问题',
        });
      },
      { timeout: 3000 },
    );
  });

  it('does not let write-back failures affect the session', async () => {
    mocks.octokitConstructorMock.mockImplementation(() => ({
      apps: {
        getRepoInstallation: vi.fn().mockRejectedValue(new Error('GitHub API error')),
      },
    }));

    mocks.listSessionMessagesMock.mockReturnValue([
      {
        id: 'msg-1',
        role: 'assistant',
        createdAt: Date.now(),
        content: [{ type: 'text', text: '分析完成' }],
      },
    ]);
    mocks.extractMessageTextMock.mockReturnValue('分析完成');

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await app.inject({
      method: 'POST',
      url: '/github/triggers',
      headers: { authorization: 'Bearer user-wbfail' },
      payload: {
        appId: 'app-wbfail',
        privateKeyPem: 'pem-wbfail',
        webhookSecretForHmacVerification: 'secret-wbfail',
        repoFullNameOwnerSlashRepo: 'acme/writeback-fail',
        events: ['pull_request.opened'],
        agentPromptTemplate: 'Review PR',
        autoApproveWithoutUserConfirmation: false,
      },
    });

    const webhookBody = JSON.stringify({
      action: 'opened',
      repository: { full_name: 'acme/writeback-fail' },
      pull_request: {
        number: 100,
        title: 'Fail PR',
        head: { sha: 'def456', ref: 'feature' },
        base: { ref: 'main' },
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/github/webhook',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-hub-signature-256': signPayload('secret-wbfail', webhookBody),
      },
      payload: JSON.parse(webhookBody),
    });

    expect(response.statusCode).toBe(202);

    await vi.waitFor(
      () => {
        expect(consoleSpy).toHaveBeenCalledWith(
          'GitHub write-back failed (non-fatal)',
          expect.objectContaining({ sessionId: expect.any(String) }),
        );
      },
      { timeout: 2000 },
    );

    consoleSpy.mockRestore();
  });
});
