import { createHmac } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGitHubTimeoutFetch,
  GITHUB_API_TIMEOUT_MS,
  githubRoutes,
  restoreGitHubTriggers,
} from '../../github/router.js';
import { connectDb, migrate, sqliteGet, sqliteRun } from '../../infra/db.js';
import requestWorkflowPlugin from '../../runtime/request-workflow.js';

const streamRuntimeMock = vi.hoisted(() => ({
  // 永不 resolve：会话 INSERT 与 HTTP 响应都发生在后台启动之前，桩掉后台执行
  // 即可隔离真实 Agent 运行与 GitHub 回写，同时不产生网络调用。
  runSessionInBackground: vi.fn(() => new Promise(() => undefined)),
}));

vi.mock('../../routes/stream-runtime.js', () => ({
  runSessionInBackground: streamRuntimeMock.runSessionInBackground,
}));

/**
 * §0.154: the GitHub write-back path builds two Octokit v22 (native-fetch)
 * clients. Octokit v22 has no `request.timeout`, so a connects-but-hangs
 * GitHub API would leave `performWriteBack` (run inside a fire-and-forget
 * `.then()`) pending forever. The fix injects a `request.fetch` that merges
 * `AbortSignal.timeout` with any caller signal. These tests pin the wrapper's
 * behaviour without a live network.
 */
describe('createGitHubTimeoutFetch (§0.154)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('默认超时常量为 30s', () => {
    expect(GITHUB_API_TIMEOUT_MS).toBe(30_000);
  });

  it('转发到底层 fetch 并附带一个 AbortSignal', async () => {
    const underlying = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }));
    const wrapped = createGitHubTimeoutFetch(30_000);

    await wrapped('https://api.github.com/x');

    expect(underlying).toHaveBeenCalledTimes(1);
    const init = underlying.mock.calls[0]![1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('超时触发时合并信号 abort（不永久 pending）', async () => {
    // Underlying fetch never resolves on its own; it only rejects when the
    // injected signal aborts — exactly the connects-but-hangs shape. A tiny
    // real timeout keeps the test deterministic and fast (vitest fake timers
    // do not hook `AbortSignal.timeout`).
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const wrapped = createGitHubTimeoutFetch(20);
    await expect(wrapped('https://api.github.com/slow')).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('调用方信号 abort 时合并信号也 abort', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const wrapped = createGitHubTimeoutFetch(60_000);
    const caller = new AbortController();
    const pending = wrapped('https://api.github.com/x', { signal: caller.signal });
    caller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

/**
 * 回归：GitHub 触发器 `autoApproveWithoutUserConfirmation` 此前只进入请求级
 * `requestData.yoloMode`（仅投影系统提示词），而工具审批强制执行只读会话
 * metadata（tool-sandbox.ensurePermissionForTool → resolveSessionPermissionMode）。
 * 结果是无人值守的 GitHub 运行仍会创建无人可答的 pending 权限请求而卡死。
 * 修复后 autoApprove:true 必须把规范键 `permissionMode:'yolo'` 写进创建会话的
 * metadata；false 时不写任何档位键，保持 `ask` 兜底。
 */
describe('GitHub 触发器会话权限档位（autoApprove → session metadata）', () => {
  const GITHUB_TRIGGER_USER_ID = 'u-github-trigger-permission';
  const GITHUB_WEBHOOK_SECRET = 'github-trigger-permission-secret';

  beforeAll(async () => {
    await connectDb();
    await migrate();
  });

  beforeEach(() => {
    streamRuntimeMock.runSessionInBackground.mockClear();
  });

  async function buildGitHubApp(): Promise<FastifyInstance> {
    const app = Fastify();
    await app.register(requestWorkflowPlugin);
    await app.register(githubRoutes);
    await app.ready();
    return app;
  }

  function registerGitHubTrigger(repoFullName: string, autoApprove: boolean): void {
    sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
      GITHUB_TRIGGER_USER_ID,
      'github-trigger-permission@example.com',
    ]);
    const configs = [
      {
        ownerUserId: GITHUB_TRIGGER_USER_ID,
        appId: '1',
        privateKeyPem: 'test-private-key',
        webhookSecretForHmacVerification: GITHUB_WEBHOOK_SECRET,
        repoFullNameOwnerSlashRepo: repoFullName,
        events: ['push'],
        agentPromptTemplate: '处理 {{repo}}',
        autoApproveWithoutUserConfirmation: autoApprove,
      },
    ];
    sqliteRun(
      `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'github_triggers', ?)
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
      [GITHUB_TRIGGER_USER_ID, JSON.stringify(configs)],
    );
    restoreGitHubTriggers();
  }

  async function postPushWebhook(app: FastifyInstance, repoFullName: string): Promise<string> {
    const payload = JSON.stringify({
      ref: 'refs/heads/main',
      repository: { full_name: repoFullName },
    });
    const signature = createHmac('sha256', GITHUB_WEBHOOK_SECRET).update(payload).digest('hex');
    const response = await app.inject({
      method: 'POST',
      url: '/github/webhook',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'push',
        'x-hub-signature-256': `sha256=${signature}`,
      },
      payload,
    });
    expect(response.statusCode).toBe(202);
    const sessionId = (response.json() as { sessionId?: string }).sessionId;
    if (!sessionId) {
      throw new Error('GitHub 触发器未返回 sessionId');
    }
    return sessionId;
  }

  function readCreatedSessionMetadata(sessionId: string): Record<string, unknown> {
    const row = sqliteGet<{ metadata_json: string | null }>(
      'SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1',
      [sessionId],
    );
    const metadataJson = row?.metadata_json;
    if (!metadataJson) {
      throw new Error(`未找到 GitHub 触发器创建的会话：${sessionId}`);
    }
    return JSON.parse(metadataJson) as Record<string, unknown>;
  }

  it('autoApprove:true 时创建的会话 metadata 携带 permissionMode:yolo', async () => {
    registerGitHubTrigger('owner/rung-yolo', true);
    const app = await buildGitHubApp();
    try {
      const sessionId = await postPushWebhook(app, 'owner/rung-yolo');
      const metadata = readCreatedSessionMetadata(sessionId);

      expect(metadata['permissionMode']).toBe('yolo');
      expect(metadata['githubTrigger']).toEqual({
        eventType: 'push',
        repoFullName: 'owner/rung-yolo',
      });
      // 请求级 yoloMode（系统提示词投影）保持原样，不受本次修复影响。
      expect(streamRuntimeMock.runSessionInBackground).toHaveBeenCalledWith(
        expect.objectContaining({
          requestData: expect.objectContaining({ yoloMode: true }),
          sessionId,
          userId: GITHUB_TRIGGER_USER_ID,
        }),
      );
    } finally {
      await app.close();
    }
  });

  it('autoApprove:false 时 metadata 不含任何权限档位键（保持 ask 兜底）', async () => {
    registerGitHubTrigger('owner/rung-ask', false);
    const app = await buildGitHubApp();
    try {
      const sessionId = await postPushWebhook(app, 'owner/rung-ask');
      const metadata = readCreatedSessionMetadata(sessionId);

      expect('permissionMode' in metadata).toBe(false);
      expect('yoloMode' in metadata).toBe(false);
      expect(streamRuntimeMock.runSessionInBackground).toHaveBeenCalledWith(
        expect.objectContaining({
          requestData: expect.objectContaining({ yoloMode: false }),
        }),
      );
    } finally {
      await app.close();
    }
  });
});
