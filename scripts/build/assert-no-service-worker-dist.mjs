/**
 * 桌面端打包防呆：确认交给 Tauri 内嵌的 web 产物里没有 Service Worker。
 *
 * 背景：历史版本把 VitePWA 的 Service Worker 一起打进了 exe。SW 的注册信息与
 * precache 跨版本存活在 WebView 用户数据目录里，普通刷新会被旧 SW 拦截返回旧
 * 页面（「强刷是新版、普通刷新回到旧版」）。桌面端有独立的 updater 机制，
 * 打包时绝不能再带上 SW。
 *
 * 用法：
 *   node scripts/build/assert-no-service-worker-dist.mjs            # 检查 apps/web/dist
 *   node scripts/build/assert-no-service-worker-dist.mjs <distDir>  # 检查指定目录
 *
 * 也可在构建流程内直接复用 assertNoServiceWorkerInDist()：
 * - apps/web/vite.config.ts 在桌面构建（isDesktopBuild）的 closeBundle 里断言，
 *   命中即让 `tauri build` 失败；
 * - apps/desktop 的 build 脚本在 tauri build 之后再做一次端到端断言。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** 默认检查的产物目录：apps/web/dist 同时是桌面端 frontendDist 与 web-dist 资源的来源。 */
export const DEFAULT_WEB_DIST_DIR = resolve(rootDir, 'apps/web/dist');

/** SW 相关产物文件名：任一存在即视为污染。 */
const SERVICE_WORKER_ARTIFACTS = ['sw.js', 'registerSW.js'];

/** index.html 中指示 SW 注册的标记。 */
const INDEX_HTML_SERVICE_WORKER_PATTERNS = [
  { label: 'registerSW.js', pattern: /registerSW\.js/ },
  { label: 'serviceWorker.register', pattern: /serviceWorker\.register/ },
];

/**
 * 收集 dist 目录里的 Service Worker 残留，返回人类可读的描述列表（空数组表示干净）。
 */
export function collectServiceWorkerArtifacts(distDir = DEFAULT_WEB_DIST_DIR) {
  const offenders = [];

  for (const fileName of SERVICE_WORKER_ARTIFACTS) {
    if (existsSync(resolve(distDir, fileName))) {
      offenders.push(fileName);
    }
  }

  const indexPath = resolve(distDir, 'index.html');
  if (existsSync(indexPath)) {
    const html = readFileSync(indexPath, 'utf8');
    for (const { label, pattern } of INDEX_HTML_SERVICE_WORKER_PATTERNS) {
      if (pattern.test(html)) {
        offenders.push(`index.html 含 ${label} 引用`);
      }
    }
  }

  return offenders;
}

/**
 * 断言 dist 目录不含 Service Worker 残留，命中则抛错（让构建直接失败）。
 */
export function assertNoServiceWorkerInDist(distDir = DEFAULT_WEB_DIST_DIR) {
  const offenders = collectServiceWorkerArtifacts(distDir);
  if (offenders.length === 0) {
    return;
  }

  throw new Error(
    [
      `[desktop] web 产物中检测到 Service Worker 残留：${offenders.join('、')}`,
      `检查目录：${distDir}`,
      '桌面端打包必须禁用 PWA（apps/web/vite.config.ts 的 VitePWA.disable）。',
      '处理方式：',
      '  1) 清掉旧产物：pnpm --filter @openAwork/web clean',
      '  2) 打包走 pnpm --filter @openAwork/desktop build（beforeBuildCommand 会重建 dist）；',
      '     若在 Tauri CLI 之外单独构建 web，需要带 OPENAWORK_DESKTOP_BUILD=1 再构建。',
    ].join('\n'),
  );
}

const isCliEntry =
  typeof process.argv[1] === 'string' &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCliEntry) {
  const targetDir = process.argv[2]
    ? resolve(process.cwd(), process.argv[2])
    : DEFAULT_WEB_DIST_DIR;
  try {
    assertNoServiceWorkerInDist(targetDir);
    console.log(`[desktop] web 产物无 Service Worker 残留：${targetDir}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
