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
