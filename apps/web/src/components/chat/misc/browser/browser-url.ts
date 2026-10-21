/**
 * 内置浏览器地址工具：用户手输规范化 + 实时引擎可导航地址判定。
 */

/**
 * 可交给网关侧实时引擎导航的地址：只接受显式 http(s)。
 *
 * 占位页（`about:blank`）不需要「主动导航」；但从真实页面回落到占位页时（关掉
 * 最后一个标签 / 清空预览），调用方仍要显式下发一次空白页导航，让远端卸载旧页面
 * ——否则 Chromium 会留在旧页面持续产帧。引擎画面与 Tauri 采集导航同步
 * （`useBrowserLiveNavigation`）共用这一份判定，避免两处漂移。
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
