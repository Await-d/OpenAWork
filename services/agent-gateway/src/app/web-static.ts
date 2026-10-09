import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import fastifyStatic from '@fastify/static';
import { join, dirname, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, statSync } from 'fs';
import type { SpaFallbackSink } from '../infra/error-handler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface WebStaticPluginOptions {
  /**
   * 根 404 处理器的 SPA 注入点（`registerErrorHandler` 的返回值）。Fastify 禁止在同一
   * 封装上下文重复注册 404 处理器，SPA 兜底只能经由此接口注入，插件内不得自行
   * `setNotFoundHandler`。
   */
  spaFallback: SpaFallbackSink;
}

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

  // 源码布局：services/agent-gateway/src/app/web-static.ts → ../../../../apps/web/dist
  const fromSource = join(__dirname, '../../../../apps/web/dist');
  if (existsSync(fromSource)) return fromSource;

  return null;
}

async function webStaticPlugin(
  app: FastifyInstance,
  options: WebStaticPluginOptions,
): Promise<void> {
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

  try {
    await app.register(fastifyStatic, {
      root: webDistPath,
      prefix: '/',
      decorateReply: true,
    });

    // SPA 历史模式兜底（仅浏览器 GET/HEAD 且接受 HTML 时返回 index.html，API 型 404
    // 维持 JSON）由根 404 处理器统一实现，这里只注入 index.html——Fastify 同一封装
    // 上下文重复注册 404 处理器会直接抛错，插件内不得再调用 `setNotFoundHandler`。
    options.spaFallback.setSpaIndexHtml(readFileSync(indexHtmlPath, 'utf8'));
  } catch (error) {
    // 静态托管是可选能力：初始化失败时降级为 API-only，绝不连带网关启动一起失败
    // （历史事故：404 处理器重复注册抛出的异常直接打挂桌面端 sidecar 进程）。
    app.log.warn({ err: error, webDistPath }, 'web-static: 初始化失败，降级为 API-only');
    return;
  }

  app.log.info({ webDistPath }, 'web-static: serving Web frontend');
}

export default fp(webStaticPlugin, { name: 'web-static' });
