/**
 * 模式提示词覆盖 HTTP 契约测试。
 *
 * 锁定：鉴权、未知模式/空白/超限/非法字符的 400、用户隔离、写入回读、
 * reset 幂等，以及 GET 同时返回默认值（UI 需要默认值作为编辑起点）。
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as PromptOverridesRoutesModule from '../../routes/prompt-overrides.js';
import type * as StoreModule from '../../prompt/prompt-override-store.js';
import { registerErrorHandler } from '../../infra/error-handler.js';

// 部分 mock（`importOriginal` 展开真实实现，只替换一个函数）：仅在需要模拟
// 基础设施故障时抛错，其余用例仍走真实 store → SQLite 链路。
const storeFailure = vi.hoisted(() => ({ failWrite: false }));
vi.mock('../../prompt/prompt-override-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof StoreModule>();
  return {
    ...actual,
    writeDialogueModePromptOverride: (
      ...args: Parameters<typeof actual.writeDialogueModePromptOverride>
    ) => {
      if (storeFailure.failWrite) {
        throw new Error('SQLITE_BUSY: database is locked');
      }
      return actual.writeDialogueModePromptOverride(...args);
    },
  };
});

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'prompt-overrides-routes-test-secret-123456';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let promptOverridesRoutes: typeof PromptOverridesRoutesModule.promptOverridesRoutes;
let store: typeof StoreModule;

const USER_ID = 'u-prompt-routes';
const OTHER_USER_ID = 'u-prompt-routes-other';

interface ModeViewFixture {
  readonly mode: string;
  readonly defaultText: string;
  readonly effectiveText: string;
  readonly hasOverride: boolean;
}

interface SnapshotFixture {
  readonly modes: readonly ModeViewFixture[];
  readonly maxChars: number;
  readonly configState: string;
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(promptOverridesRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance, userId = USER_ID): string {
  return `Bearer ${app.jwt.sign({ sub: userId, email: `${userId}@example.com` })}`;
}

function seedUser(id: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    `${id}@example.com`,
  ]);
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  promptOverridesRoutes = (await import('../../routes/prompt-overrides.js')).promptOverridesRoutes;
  store = await import('../../prompt/prompt-override-store.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM user_settings', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID);
  seedUser(OTHER_USER_ID);
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('prompt-overrides routes', () => {
  it('未认证返回 401', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({ method: 'GET', url: '/prompt-overrides' });
      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('GET 返回三种模式与默认值，且初始无覆盖', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/prompt-overrides',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<SnapshotFixture>();
      expect(body.configState).toBe('ok');
      expect(body.maxChars).toBe(store.PROMPT_OVERRIDE_MAX_CHARS);
      expect(body.modes.map((view) => view.mode).sort()).toEqual([
        'clarify',
        'coding',
        'programmer',
      ]);
      for (const view of body.modes) {
        expect(view.hasOverride).toBe(false);
        expect(view.defaultText).toBe(view.effectiveText);
      }
    } finally {
      await app.close();
    }
  });

  it('PUT 写入后 GET 回读覆盖，reset 后幂等回默认', async () => {
    const app = await buildApp();
    const authorization = bearer(app);
    try {
      const write = await app.inject({
        method: 'PUT',
        url: '/prompt-overrides/dialogue-modes/coding',
        headers: { authorization },
        payload: { text: '  自定义编程纪律  ' },
      });

      expect(write.statusCode).toBe(200);
      const written = write.json<{ promptOverride: ModeViewFixture }>().promptOverride;
      expect(written.hasOverride).toBe(true);
      // 前后空白必须原样保留
      expect(written.effectiveText).toBe('  自定义编程纪律  ');

      const afterReset = await app.inject({
        method: 'POST',
        url: '/prompt-overrides/dialogue-modes/coding/reset',
        headers: { authorization },
      });
      expect(afterReset.statusCode).toBe(200);
      const resetView = afterReset.json<{ promptOverride: ModeViewFixture }>().promptOverride;
      expect(resetView.hasOverride).toBe(false);
      expect(resetView.effectiveText).toBe(resetView.defaultText);

      const idempotent = await app.inject({
        method: 'POST',
        url: '/prompt-overrides/dialogue-modes/coding/reset',
        headers: { authorization },
      });
      expect(idempotent.statusCode).toBe(200);
      expect(
        idempotent.json<{ promptOverride: ModeViewFixture }>().promptOverride.hasOverride,
      ).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('未知模式与空白文本返回 400，且带明确文案', async () => {
    const app = await buildApp();
    const authorization = bearer(app);
    try {
      const unknownMode = await app.inject({
        method: 'PUT',
        url: '/prompt-overrides/dialogue-modes/nope',
        headers: { authorization },
        payload: { text: 'x' },
      });
      expect(unknownMode.statusCode).toBe(400);
      expect(unknownMode.json<{ error: string }>().error).toBe(
        store.PROMPT_OVERRIDE_ERROR_MESSAGES.unknownMode,
      );

      const blank = await app.inject({
        method: 'PUT',
        url: '/prompt-overrides/dialogue-modes/coding',
        headers: { authorization },
        payload: { text: '   ' },
      });
      expect(blank.statusCode).toBe(400);
      expect(blank.json<{ error: string }>().error).toBe(
        store.PROMPT_OVERRIDE_ERROR_MESSAGES.emptyText,
      );
    } finally {
      await app.close();
    }
  });

  it('缺失或非字符串 text 走全局错误 handler 返回 400 且文案稳定', async () => {
    const app = await buildApp();
    const authorization = bearer(app);
    try {
      // `parseBody` 在 try 之外：缺失 / 非字符串 text 不会进 store，而是抛 ApiError，
      // 由全局错误 handler 归一为 `{ name: 'BadRequest', data: { message, kind } }`。
      // 这两条此前无测试钉住，schema 一旦被放宽（如 text 支持可选）会静默漏过。
      for (const payload of [{}, { text: 123 }, { text: null }]) {
        const response = await app.inject({
          method: 'PUT',
          url: '/prompt-overrides/dialogue-modes/coding',
          headers: { authorization },
          payload,
        });
        expect(response.statusCode).toBe(400);
        const body = response.json<{ name: string; data: { message: string; kind?: string } }>();
        expect(body.name).toBe('BadRequest');
        expect(body.data.message).toBe('请求体参数无效。');
        expect(body.data.kind).toBe('Body');
      }

      // 参数校验失败不得落库：写入前后快照都应是无覆盖。
      const snapshot = await app.inject({
        method: 'GET',
        url: '/prompt-overrides',
        headers: { authorization },
      });
      for (const view of snapshot.json<SnapshotFixture>().modes) {
        expect(view.hasOverride).toBe(false);
      }
    } finally {
      await app.close();
    }
  });

  it('超限与非法控制字符返回 400', async () => {
    const app = await buildApp();
    const authorization = bearer(app);
    try {
      const tooLong = await app.inject({
        method: 'PUT',
        url: '/prompt-overrides/dialogue-modes/coding',
        headers: { authorization },
        payload: { text: 'x'.repeat(store.PROMPT_OVERRIDE_MAX_CHARS + 1) },
      });
      expect(tooLong.statusCode).toBe(400);
      // 文案必须来自 store 单一真相源：若 schema 先按 `.max()` 拦截，
      // 这里会拿到框架的通用文案（复查修复）。
      expect(tooLong.json<{ error: string }>().error).toBe(
        store.PROMPT_OVERRIDE_ERROR_MESSAGES.tooLong,
      );

      const zeroWidth = await app.inject({
        method: 'PUT',
        url: '/prompt-overrides/dialogue-modes/coding',
        headers: { authorization },
        payload: { text: `bad${String.fromCodePoint(0x200b)}text` },
      });
      expect(zeroWidth.statusCode).toBe(400);
      expect(zeroWidth.json<{ error: string }>().error).toBe(
        store.PROMPT_OVERRIDE_ERROR_MESSAGES.invalidCharacters,
      );
    } finally {
      await app.close();
    }
  });

  it('中文达到字符上限仍可保存（实测 bodyLimit 对 UTF-8 膨胀有余量）', async () => {
    const app = await buildApp();
    try {
      // 32768 个中文字符 ≈ 96 KiB UTF-8 body；若网关 bodyLimit 不足会 413。
      const response = await app.inject({
        method: 'PUT',
        url: '/prompt-overrides/dialogue-modes/coding',
        headers: { authorization: bearer(app) },
        payload: { text: '中'.repeat(store.PROMPT_OVERRIDE_MAX_CHARS) },
      });

      expect(response.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('存储层基础设施错误返回 500，不伪装成参数问题', async () => {
    storeFailure.failWrite = true;
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PUT',
        url: '/prompt-overrides/dialogue-modes/coding',
        headers: { authorization: bearer(app) },
        payload: { text: 'x' },
      });

      expect(response.statusCode).toBe(500);
    } finally {
      storeFailure.failWrite = false;
      await app.close();
    }
  });

  it('用户之间互不影响', async () => {
    const app = await buildApp();
    try {
      await app.inject({
        method: 'PUT',
        url: '/prompt-overrides/dialogue-modes/coding',
        headers: { authorization: bearer(app, USER_ID) },
        payload: { text: 'A 的纪律' },
      });

      const other = await app.inject({
        method: 'GET',
        url: '/prompt-overrides',
        headers: { authorization: bearer(app, OTHER_USER_ID) },
      });

      const body = other.json<SnapshotFixture>();
      for (const view of body.modes) {
        expect(view.hasOverride).toBe(false);
      }
    } finally {
      await app.close();
    }
  });
});
