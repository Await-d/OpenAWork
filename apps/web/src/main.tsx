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

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

const DESKTOP_SW_CLEANUP_KEY = 'openawork.desktop.sw-cleanup-version';

/**
 * 桌面端生产构建复用 apps/web/dist。历史版本把 VitePWA Service Worker 一起
 * 打进了 Tauri WebView，SW 的 NavigationRoute + precache 会跨版本拦截导航，
 * 出现“强刷是新版、普通刷新回到旧版”。
 *
 * 主清理在原生侧 `clear_all_browsing_data`（见 lib.rs）。本函数是安全网：
 * 仅在真正的生产入口 apps/web/src/main.tsx 执行（desktop/src/main.tsx 生产不跑）。
 * 只清 SW + CacheStorage，不动业务 localStorage。
 *
 * 返回 true 表示已清理且需要 reload（调用方不要再 mount）。
 * 同一版本最多 reload 一次，避免循环。
 */
async function cleanupDesktopServiceWorkerResidue(): Promise<boolean> {
  if (!isTauriRuntime()) {
    return false;
  }

  try {
    const alreadyCleanedFor =
      typeof localStorage !== 'undefined' ? localStorage.getItem(DESKTOP_SW_CLEANUP_KEY) : null;

    // 本版本已清理过：最多再静默 unregister 残留，不再 reload。
    if (alreadyCleanedFor === __APP_VERSION__) {
      if ('serviceWorker' in navigator) {
        const leftover = await navigator.serviceWorker.getRegistrations();
        await Promise.all(leftover.map((r) => r.unregister()));
      }
      return false;
    }

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

    // 先写版本 gate，再决定是否 reload，防止无限循环。
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(DESKTOP_SW_CLEANUP_KEY, __APP_VERSION__);
    }

    return cleanedSomething;
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

// 桌面端：先清残留 SW/缓存再挂载。若确实清到了东西，reload 一次让后续
// 导航不再被旧 controller 劫持。版本号 gate 防止无限 reload。
void cleanupDesktopServiceWorkerResidue()
  .then((cleanedSomething) => {
    if (cleanedSomething) {
      // 旧 SW controller 可能仍在当前文档生命周期内生效，reload 后才会彻底脱离。
      window.location.reload();
      return;
    }
    mountApp();
  })
  .catch(() => {
    mountApp();
  });
