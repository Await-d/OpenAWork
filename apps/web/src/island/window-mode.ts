/**
 * 桌面端窗口模式识别。
 *
 * Rust 侧创建灵动岛窗口时通过 `initialization_script` 注入
 * `window.__OPENAWORK_WINDOW_MODE__ = 'island'`;主窗口不注入,因此默认 `main`。
 * 这条通路不依赖 URL query(`WebviewUrl::App` 下 query 在 Windows 上不可靠),
 * 也不需要 `@tauri-apps/api` 的窗口 API。
 */
export type DesktopWindowMode = 'main' | 'island';

declare global {
  interface Window {
    /** 由 Rust 初始化脚本注入:标识当前 WebView 是灵动岛窗口。 */
    __OPENAWORK_WINDOW_MODE__?: string;
  }
}

/** 读取当前 WebView 的窗口模式(无法判定时按主窗口处理)。 */
export function readDesktopWindowMode(): DesktopWindowMode {
  if (typeof window === 'undefined') {
    return 'main';
  }
  return window.__OPENAWORK_WINDOW_MODE__ === 'island' ? 'island' : 'main';
}
