import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import type { Logger, LoggerEvent } from 'babel-plugin-react-compiler';
import versionPlugin from '../../scripts/build/vite-plugin-version.mjs';
import fileIconAssetsPlugin from '../../scripts/build/vite-plugin-file-icons.mjs';
import { assertNoServiceWorkerInDist } from '../../scripts/build/assert-no-service-worker-dist.mjs';

/**
 * 桌面端（Tauri）构建标记。
 * - Tauri CLI 会为 beforeBuildCommand 注入 `TAURI_ENV_PLATFORM`；
 * - `OPENAWORK_DESKTOP_BUILD` 是我们自己的显式开关（CI / 本地打包注入），
 *   避免打包链路里 CLI 注入值丢失时，PWA 又被悄悄带进 exe。
 */
const isDesktopBuild =
  Boolean(process.env.TAURI_ENV_PLATFORM) || process.env.OPENAWORK_DESKTOP_BUILD === '1';

/**
 * 路径锚点：报表路径与文件名一律基于这两个常量解析，而不是 `process.cwd()`。
 * 因为同一份配置会被多种入口调用（`vite`、`tauri build`、CI 直接调 vite），
 * 工作目录并不稳定。
 */
const WEB_ROOT = fileURLToPath(new URL('./', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * material-icon-theme 在隔离式 node_modules 下只装在 apps/web/node_modules，
 * 必须从 apps/web/package.json 锚定解析，否则根目录解析不到该包。
 */
const requireFromWeb = createRequire(new URL('./package.json', import.meta.url));
const materialIconThemeDir = path.dirname(
  requireFromWeb.resolve('material-icon-theme/package.json'),
);

/**
 * ─── React Compiler 脱靶可观测性 ────────────────────────────────────────────
 *
 * 编译器对无法优化的组件 / 自定义 Hook 是**静默跳过**的：不进产物、不报错、也
 * 不中断构建。于是「某个文件是否已被编译器接管」在现场无法判断——而它恰恰决定
 * 了手写 `useMemo` / `useCallback` 能否安全删除：在脱靶文件里删 memo 会造成性能
 * 回退，若该回调被 `useEffect` 依赖引用还可能触发无限渲染循环。
 *
 * 本开关默认**完全关闭**（不设环境变量时零行为变更、零额外开销）：
 *   OPENAWORK_COMPILER_LOG=1              脱靶逐条打印到 stderr（dev / build 均生效）
 *   OPENAWORK_COMPILER_LOG=<file.json>    构建结束时额外写 JSON 报表（仅 build）
 *
 * 注意：dev 模式按需编译，报表只覆盖你实际访问过的模块，所以路径形式只用于 build。
 *
 * 深度分析（按原因分类 / 与基线对比 / CI 门禁）请用：
 *   bun run check:react-compiler
 */
const COMPILER_LOG_TARGET = process.env.OPENAWORK_COMPILER_LOG?.trim() ?? '';
const COMPILER_LOG_VERBOSE = COMPILER_LOG_TARGET === '1';
const COMPILER_REPORT_PATH =
  COMPILER_LOG_TARGET && !COMPILER_LOG_VERBOSE ? COMPILER_LOG_TARGET : null;

type CompilerBailoutRecord = {
  file: string;
  line: number | null;
  kind: string;
  reason: string;
};

const compilerBailouts: CompilerBailoutRecord[] = [];
const compilerStats = { compiledFunctions: 0, bailoutFunctions: 0, memoizedValues: 0 };

/**
 * 三种脱靶事件的字段位置并不一致，不能一把梭读 `detail`：
 * `CompileError` 的 reason 在 `detail` 下，`CompileSkip` 的 reason 在顶层，
 * `PipelineError` 的说明在顶层 `data`。
 */
function describeCompilerBailout(event: LoggerEvent): string {
  switch (event.kind) {
    case 'CompileError':
      return event.detail?.reason ?? '未知编译错误';
    case 'CompileSkip':
      return event.reason ?? '未知跳过原因';
    case 'PipelineError':
      return `PipelineError: ${event.data ?? ''}`;
    default:
      return `未知事件类型：${event.kind}`;
  }
}

function createCompilerLogger(): Logger | null {
  if (!COMPILER_LOG_TARGET) return null;

  return {
    logEvent(filename: string | null, event: LoggerEvent): void {
      if (event.kind === 'CompileSuccess') {
        compilerStats.compiledFunctions += 1;
        compilerStats.memoizedValues += event.memoValues;
        return;
      }
      const isBailout =
        event.kind === 'CompileError' ||
        event.kind === 'CompileSkip' ||
        event.kind === 'PipelineError';
      if (!isBailout) return;

      const reason = describeCompilerBailout(event);
      const file = filename ? path.relative(REPO_ROOT, filename) : '(unknown)';
      const line = event.fnLoc?.start.line ?? null;
      compilerStats.bailoutFunctions += 1;
      compilerBailouts.push({ file, line, kind: event.kind, reason });

      if (COMPILER_LOG_VERBOSE) {
        console.warn(`[react-compiler] 脱靶 ${file}:${line ?? '?'} — ${reason}`);
      }
    },
  };
}

/** 构建结束时落盘脱靶报表（仅在 OPENAWORK_COMPILER_LOG 指向文件路径时启用）。 */
function compilerBailoutReportPlugin(): Plugin {
  return {
    name: 'openawork:react-compiler-bailout-report',
    apply: 'build',
    closeBundle() {
      if (!COMPILER_REPORT_PATH) return;
      const out = path.resolve(WEB_ROOT, COMPILER_REPORT_PATH);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(
        out,
        `${JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            scope: 'vite-build',
            totals: compilerStats,
            bailouts: compilerBailouts,
          },
          null,
          2,
        )}\n`,
      );
      console.log(
        `[react-compiler] 脱靶 ${compilerStats.bailoutFunctions} 个函数，报表已写入 ${out}`,
      );
    },
  };
}

/**
 * 桌面端打包防呆：vite build 写盘结束后立刻断言 dist 里没有 SW 产物，
 * 命中直接让 tauri build 失败，避免带 SW 的安装包流到用户机器上。
 * 浏览器（Web 端）构建仍然保留 PWA，不受影响。
 */
function desktopNoServiceWorkerGuard(): Plugin {
  return {
    name: 'openawork:desktop-no-service-worker-guard',
    apply: 'build',
    closeBundle() {
      if (!isDesktopBuild) {
        return;
      }
      assertNoServiceWorkerInDist(fileURLToPath(new URL('./dist', import.meta.url)));
    },
  };
}

export default defineConfig({
  resolve: {
    alias: {
      '@openAwork/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
      '@openAwork/logger': fileURLToPath(
        new URL('../../packages/logger/src/index.ts', import.meta.url),
      ),
      '@openAwork/shared-ui': fileURLToPath(
        new URL('../../packages/shared-ui/src/index.ts', import.meta.url),
      ),
      '@openAwork/web-client': fileURLToPath(
        new URL('../../packages/web-client/src/index.ts', import.meta.url),
      ),
      // 强制所有 workspace 包解析到同一份 React 实例，避免 monorepo 中
      // 多个 React 副本导致 "Invalid hook call" / useContext 返回 null
      react: fileURLToPath(new URL('node_modules/react', import.meta.url)),
      'react-dom': fileURLToPath(new URL('node_modules/react-dom', import.meta.url)),
    },
    dedupe: ['react', 'react-dom'],
  },
  plugins: [
    versionPlugin(),
    fileIconAssetsPlugin({ packageDir: materialIconThemeDir }),
    react({
      // React Compiler（1.0 stable）：自动插入 useMemo / useCallback / React.memo。
      // 启用后无需再手写大量手动 memoize；保留的手写 memo 不会被移除，编译器会跳过。
      // target: '19' 与项目的 react@^19 对齐，避免 fallback runtime。
      // logger 默认返回 null（等同不传），仅在 OPENAWORK_COMPILER_LOG 打开时生效。
      babel: {
        plugins: [
          ['babel-plugin-react-compiler', { target: '19', logger: createCompilerLogger() }],
        ],
      },
    }),
    tailwindcss(),
    compilerBailoutReportPlugin(),
    desktopNoServiceWorkerGuard(),
    VitePWA({
      // 桌面端（Tauri）构建时禁用 PWA Service Worker：
      // Tauri WebView 跨版本持久化 SW 缓存，导致新版本更新后旧 precache 仍被使用，
      // 出现"强制刷新是新版、普通刷新回到旧版"的问题。桌面端有独立的 updater 机制，无需 PWA。
      disable: isDesktopBuild,
      registerType: 'autoUpdate',
      devOptions: { enabled: false },
      includeAssets: ['favicon.ico', 'favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'OpenAWork',
        short_name: 'OpenAWork',
        description: 'AI Agent Workspace',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Monaco editor + workers are large; exclude them from precache
        // and let the browser cache them normally via HTTP caching.
        // file-icons 为 1000+ 个按需图标，全量预缓存会显著拖慢 SW 安装。
        globIgnores: ['**/*worker*.js', '**/file-icons/**'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MiB
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: 'NetworkFirst',
            options: { cacheName: 'api-cache' },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    hmr: {
      protocol: 'ws',
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
      '/auth': { target: 'http://localhost:3000', changeOrigin: true },
      '/sessions': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        bypass(req) {
          const accept = req.headers['accept'] ?? '';
          if (accept.includes('text/html')) return req.url;
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      // 多页入口:index.html 为主窗口(完整工作台),island.html 为灵动岛浮窗
      // (仅 island 组件 + island.css,隔离主窗口全局样式——WebKitGTK 透明窗口上
      // 全局 CSS 的 filter/backdrop 声明会让浮窗合成输出整帧丢失,见 island.css 头注释)。
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        island: fileURLToPath(new URL('./island.html', import.meta.url)),
      },
      // @antv/g6 依赖 @antv/util，后者在模块顶层使用 `"use client"` 指令，
      // 在 ESM 构建下会刷 MODULE_LEVEL_DIRECTIVE 警告（不影响运行）。
      // 官方 FAQ 给出的处理方式即在此处静默该警告。
      onwarn(warning, warn) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('@antv/util')) {
          return;
        }
        warn(warning);
      },
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          router: ['react-router'],
          zustand: ['zustand'],
          'monaco-editor': ['monaco-editor'],
        },
      },
    },
  },
});
