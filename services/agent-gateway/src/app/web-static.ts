import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import fastifyStatic from '@fastify/static';
import { join, dirname, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, statSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 解析 Web 前端静态资源目录。优先级：
 * 1. `OPENAWORK_WEB_DIST` 环境变量（绝对路径）—— 桌面端 Tauri sidecar 走这条路径，
 *    Rust 侧 `resolve_web_dist_path` 把 `bundle.resources` 中复制到 resource_dir 的
 *    `web-dist/` 子目录解析出来再注入。这样 Bun 编译后的单文件二进制也能找到前端。
 * 2. `apps/web/dist` 相对源码 —— dev / 源码运行 / 工作区根目录运行时使用。
 *
 * 任何路径不存在或不是目录就跳过托管，让 gateway 仅作为纯 API 服务启动。
 */
function resolveWebDistPath(): string | null {
  const fromEnv = globalThis.process?.env?.['OPENAWORK_WEB_DIST'];
  if (fromEnv && isAbsolute(fromEnv)) {
    try {
      if (statSync(fromEnv).isDirectory()) return fromEnv;
    } catch {
      // ignore — fall back to source-relative resolution
    }
  }

  // 源码布局：services/agent-gateway/src/web-static.ts → ../../../apps/web/dist
  const fromSource = join(__dirname, '../../../apps/web/dist');
  if (existsSync(fromSource)) return fromSource;

  return null;
}

async function webStaticPlugin(app: FastifyInstance): Promise<void> {
  const webDistPath = resolveWebDistPath();

  if (!webDistPath) {
    app.log.info(
      'web-static: skip (no OPENAWORK_WEB_DIST env and no apps/web/dist on disk); gateway will serve API only',
    );
    return;
  }

  const indexHtmlPath = join(webDistPath, 'index.html');
  if (!existsSync(indexHtmlPath)) {
    app.log.warn(
      { webDistPath },
      'web-static: directory exists but index.html missing; skipping static handler',
    );
    return;
  }

  await app.register(fastifyStatic, {
    root: webDistPath,
    prefix: '/',
    decorateReply: true,
  });

  const indexHtml = readFileSync(indexHtmlPath, 'utf8');

  // SPA 历史模式兜底：仅对浏览器发起的 GET/HEAD 且明确接受 HTML 的请求
  // 返回 index.html 让前端 router 接管。API 客户端（curl/axios 默认 Accept: */*、
  // 或显式 Accept: application/json）维持 JSON 404，避免把误打的 API 路径
  // 伪装成成功的 HTML 响应，破坏下游的错误处理。
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const method = request.method.toUpperCase();
    const accept = String(request.headers['accept'] ?? '');
    const isHtmlNav = (method === 'GET' || method === 'HEAD') && accept.includes('text/html');
    if (!isHtmlNav) {
      void reply.code(404).send({ error: 'not_found', path: request.url });
      return;
    }
    void reply.type('text/html').send(indexHtml);
  });

  app.log.info({ webDistPath }, 'web-static: serving Web frontend');
}

export default fp(webStaticPlugin, { name: 'web-static' });
