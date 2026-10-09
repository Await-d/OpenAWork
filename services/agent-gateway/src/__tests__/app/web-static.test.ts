/**
 * web-static 与根 404 处理器的组合回归测试。
 *
 * 历史故障：`registerErrorHandler` 与 `webStaticPlugin` 各自在根封装上下文调用
 * `setNotFoundHandler`，Fastify 对同一前缀的重复注册直接抛
 * `FST_ERR_NOT_FOUND_HANDLER_ALREADY_SET`。异常沿启动链路冒泡把网关进程打挂，
 * 桌面端 sidecar 因此永远等不到健康检查（表现为网关启动失败、托盘红点）。
 *
 * 本文件锁定两条不变量：
 * 1. 根 404 处理器只注册一次，SPA 兜底经注入点合入，两者共存不再抛错；
 * 2. 静态托管这类可选能力初始化失败时降级为 API-only，不连带网关启动一起失败。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerErrorHandler } from '../../infra/error-handler.js';
import webStaticPlugin from '../../app/web-static.js';

const INDEX_HTML = '<!doctype html><html><body>OpenAWork SPA</body></html>';

const LEVEL_WARN = 40;

interface LogEntry {
  level: number;
  msg: string;
}

interface TestApp {
  app: FastifyInstance;
  entries: LogEntry[];
}

let webDistDir = '';
let previousWebDist: string | undefined;

beforeEach(async () => {
  webDistDir = await mkdtemp(join(tmpdir(), 'openawork-web-static-'));
  await mkdir(join(webDistDir, 'assets'));
  await writeFile(join(webDistDir, 'index.html'), INDEX_HTML);
  await writeFile(join(webDistDir, 'assets', 'app.js'), 'console.log("app");');
  previousWebDist = process.env['OPENAWORK_WEB_DIST'];
  process.env['OPENAWORK_WEB_DIST'] = webDistDir;
});

afterEach(async () => {
  if (previousWebDist === undefined) {
    delete process.env['OPENAWORK_WEB_DIST'];
  } else {
    process.env['OPENAWORK_WEB_DIST'] = previousWebDist;
  }
  await rm(webDistDir, { recursive: true, force: true });
});

async function buildApp(): Promise<TestApp> {
  const entries: LogEntry[] = [];
  const app = Fastify({
    logger: {
      level: 'trace',
      stream: {
        write: (line: string): void => {
          try {
            entries.push(JSON.parse(line) as LogEntry);
          } catch {
            // 非 JSON 行（异常路径下的兜底输出）不参与断言。
          }
        },
      },
    },
  });
  const spaFallback = registerErrorHandler(app);
  await app.register(webStaticPlugin, { spaFallback });
  await app.ready();
  return { app, entries };
}

describe('webStaticPlugin 与根 404 处理器共存', () => {
  it('同时注册不再抛错，HTML 导航交给 SPA 兜底', async () => {
    const { app } = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/sessions/some-session-id',
      headers: { accept: 'text/html,application/xhtml+xml' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toBe(INDEX_HTML);
    await app.close();
  });

  it('API 型 404 维持 JSON 形状与 x-request-id，并留下 warn 记录', async () => {
    const { app, entries } = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/never-registered',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ statusCode: 404, error: 'Not Found' });
    expect(response.headers['x-request-id']).toBeTruthy();
    expect(
      entries.some((entry) => entry.level === LEVEL_WARN && entry.msg.includes('路由未命中')),
    ).toBe(true);
    await app.close();
  });

  it('静态资源仍按文件返回', async () => {
    const { app } = await buildApp();

    const response = await app.inject({ method: 'GET', url: '/assets/app.js' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('console.log');
    await app.close();
  });

  it('静态托管初始化失败时降级为 API-only，不拖垮启动', async () => {
    // index.html 是目录而非文件：existsSync 通过、readFileSync 抛 EISDIR，
    // 用来模拟静态资源损坏 / 权限异常等初始化失败场景。
    const indexHtmlPath = join(webDistDir, 'index.html');
    await rm(indexHtmlPath, { recursive: true, force: true });
    await mkdir(indexHtmlPath);

    const { app, entries } = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/some-page',
      headers: { accept: 'text/html' },
    });

    expect(
      entries.some((entry) => entry.level === LEVEL_WARN && entry.msg.includes('初始化失败')),
    ).toBe(true);
    // 降级后回到 JSON 404（无 SPA 兜底），而不是把 HTML 或异常抛给客户端。
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/json');
    await app.close();
  });
});
