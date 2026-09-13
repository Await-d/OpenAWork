import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App.js';
import './styles/layout-tokens.css';
import './index.css';
import './styles/loaders.css';
import './styles/ui-hovers.css';
import { installMonacoAsyncErrorFilter } from './components/file-editor/editor/MonacoErrorBoundary.js';
import { installExtensionNoiseFilter } from './lib/filter/extension-noise-filter.js';
import { installMonacoI18n } from './lib/monaco/monaco-i18n.js';
import { isTauriRuntime } from './utils/gateway/desktop-gateway.js';

// Configure Monaco to load from local bundle instead of CDN.
// This prevents "Monaco initialization: error" when the CDN is unreachable.
import './lib/monaco/monaco-loader.js';

// Translate Monaco's right-click menu (and related overlays) to
// Chinese. Calling here in addition to monaco-loader so the install
// doesn't depend on Monaco's own module evaluation succeeding first.
installMonacoI18n();

// Suppress noisy errors thrown by browser extensions (Tampermonkey,
// ad-blockers, ...) injecting scripts into our sandboxed preview
// iframes. These can't be fixed in our code and only clutter the
// console. See lib/extension-noise-filter.ts.
installExtensionNoiseFilter();

// Suppress noisy Monaco post-dispose async errors that fire from the
// editor's own setTimeout / rAF callbacks. They are benign in dev (only
// happen because StrictMode double-invokes effects) but clutter the
// console and mask real errors. See MonacoErrorBoundary for the React
// render-time half of the story.
installMonacoAsyncErrorFilter();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found');
// 收窄后赋给局部 const，避免闭包内控制流收窄失效导致 createRoot 仍见 null。
const root: HTMLElement = rootElement;

const DESKTOP_SW_CLEANUP_KEY = 'openawork.desktop.sw-cleanup-version';

/**
 * 桌面端缓存自愈，返回 true 表示需要带版本号重新加载页面。
 *
 * 桌面端生产构建复用 apps/web/dist。历史版本把 VitePWA Service Worker 一起
 * 打进了 Tauri WebView，SW 的 NavigationRoute + precache 会跨版本拦截导航，
 * 出现“强刷是新版、普通刷新回到旧版”。
 *
 * 主清理在原生侧：窗口创建前定向删除 WebView 缓存目录（见 lib.rs 的
 * `purge_stale_webview_caches_before_start`）。本函数是前端安全网，两层动作：
 * 1. 卸载残留 SW + 清空 CacheStorage（同版本也会静默做一次兜底）；
 * 2. 版本变化时返回 true，让调用方用 `?v=<版本>` 重新加载——新 URL 必然绕开
 *    WebView 的 HTTP 缓存，确保拿到 exe 内嵌的最新 index.html。
 *
 * 仅在真正的生产入口 apps/web/src/main.tsx 执行（desktop/src/main.tsx 生产不跑）。
 * 只清 SW + CacheStorage，不动业务 localStorage。
 *
 * 同一版本最多强刷一次，避免循环。
 */
async function healDesktopStaleCaches(): Promise<boolean> {
  if (!isTauriRuntime()) {
    return false;
  }

  try {
    const storage = typeof localStorage !== 'undefined' ? localStorage : null;
    const previousVersion = storage?.getItem(DESKTOP_SW_CLEANUP_KEY) ?? null;

    let cleanedSomething = false;

    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      if (regs.length > 0) {
        await Promise.all(regs.map((r) => r.unregister()));
        cleanedSomething = true;
      }
    }

    if ('caches' in window) {
      const keys = await caches.keys();
      if (keys.length > 0) {
        await Promise.all(keys.map((k) => caches.delete(k)));
        cleanedSomething = true;
      }
    }

    // 本版本已处理过：上面的静默兜底已做完，不再强刷，避免循环。
    if (previousVersion === __APP_VERSION__) {
      return false;
    }

    // 先写版本 gate 再决定是否强刷，防止无限循环。
    storage?.setItem(DESKTOP_SW_CLEANUP_KEY, __APP_VERSION__);

    // 首次安装（无历史版本号）且没有残留时不打扰用户；
    // 升级场景（localStorage 里还是旧版本）一定强刷一次，绕开 HTTP 缓存。
    return cleanedSomething || previousVersion !== null;
  } catch {
    // 清理失败不应阻止应用启动
    return false;
  }
}

function mountApp(): void {
  // NOTE: We deliberately do NOT wrap the tree in `<StrictMode>`.
  //
  // React 19's StrictMode double-invokes mount/cleanup/mount on every
  // component, which collides with `@monaco-editor/react@4.7`'s lifecycle:
  // the first cleanup disposes the InstantiationService and the second
  // mount tries to reuse it, throwing
  //   "InstantiationService has been disposed"
  // or
  //   "Cannot read properties of undefined (reading 'domNode')"
  // every time the user opens a file or switches editor tabs.
  //
  // `@xterm/xterm` exhibits a similar pattern (matchMedia / canvas
  // teardown). Both libraries are mature and used widely in non-React
  // editors; chasing every dispose path inside our wrapper components
  // trades a lot of complexity for an audit feature whose only customer
  // is dev-mode warnings.
  //
  // Production has never had StrictMode, so app behaviour is unchanged.
  // If we want the safety pass back later, the path forward is to swap
  // to a Monaco wrapper that's React-19-strict-aware (or write our own
  // thin one) and re-enable StrictMode at that point.
  createRoot(root).render(
    <BrowserRouter>
      <App />
    </BrowserRouter>,
  );
}

// 桌面端：先做缓存自愈再挂载。需要强刷时用带版本号的 URL 重新加载，
// 让 WebView 无法再拿缓存里的旧 index.html。版本号 gate 防止无限 reload。
void healDesktopStaleCaches()
  .then((needsReload) => {
    if (needsReload) {
      // 旧 SW controller 可能仍在当前文档生命周期内生效，重载后才会彻底脱离；
      // 多一个 query 的新 URL 必然绕开 HTTP 缓存，replace 不留历史记录。
      const url = new URL(window.location.href);
      url.searchParams.set('v', __APP_VERSION__);
      window.location.replace(url.toString());
      return;
    }
    mountApp();
  })
  .catch(() => {
    mountApp();
  });
