/**
 * Tauri 事件监听的薄封装。
 *
 * `@tauri-apps/api/event` 走**字面量**动态 import，让这段只在桌面端用到的能力
 * 被 Vite 拆成独立的懒加载 chunk，不进入 Web 端首屏包。
 *
 * 两个必须遵守的约束（曾经踩过）：
 *
 * 1. 模块说明符必须是**字面量**，且不能加 vite-ignore 注释。加了 ignore 会让
 *    Rollup 原样保留裸模块名的动态 import，而 WebView 运行时无法解析裸模块
 *    说明符，直接抛 `TypeError: Failed to resolve module specifier`。
 *    更坑的是 `vite dev` 会把动态 import 重写成 /node_modules/.vite/deps/…
 *    这类可解析路径，所以这个 bug **只在生产构建暴露**，dev 下一切正常。
 * 2. 调用方必须 catch：浏览器环境（非 Tauri）动态 import 同样会失败，
 *    但监听失败不致命，静默忽略即可。
 *
 * 写法与 `TitlebarTabStrip` / `BuiltInBrowser` 对 `@tauri-apps/api/window`
 * 的动态导入保持一致。
 */
export type UnlistenFn = () => void;

export interface TauriEvent<T> {
  event: string;
  id: number;
  payload: T;
}

export function listenTauriEvent<T>(
  event: string,
  handler: (event: TauriEvent<T>) => void,
): Promise<UnlistenFn> {
  return import('@tauri-apps/api/event').then((api) => api.listen<T>(event, handler));
}
