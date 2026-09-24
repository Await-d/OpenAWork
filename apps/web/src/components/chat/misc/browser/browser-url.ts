/**
 * 内置浏览器地址工具：用户手输规范化 + 实时引擎可导航地址判定。
 */

/**
 * 可交给网关侧实时引擎导航的地址：只接受显式 http(s)。
 * `about:blank` 之类的占位页无需下发 `navigate`——引擎画面与 Tauri 采集
 * 导航同步（`useBrowserLiveNavigation`）共用这一份判定，避免两处漂移。
 */
export const NAVIGABLE_URL_PATTERN = /^https?:\/\//i;

/**
 * 用户手输地址的规范化：无 scheme 时补 `http://`，空输入返回 null（调用方不写
 * store）。内置浏览器面板与工作区预览空态共用同一份实现，避免两处漂移。
 */
export function normalizeBrowserPreviewInput(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}
