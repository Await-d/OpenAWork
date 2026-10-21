/**
 * 路由懒加载失败的一次性自愈。
 *
 * 现场（Vite dev，`localhost:5173`）：页面打开期间依赖预构建被重建 / 服务重启，
 * 旧模块图里的请求拿不到响应，浏览器报
 * `Failed to fetch dynamically imported module: .../ChatPage.tsx`。
 * 模块文件本身是好的——已在 dev server 上逐个校验过 ChatPage 全量依赖图
 * （1159 个模块全部 200，无缺失导入）——所以这种失败只差一次整页刷新。
 *
 * 自动刷新**每个路由每次会话只做一次**：刷新后仍失败说明服务端真的坏了，
 * 再刷只会变成刷新风暴，此时把错误交给错误边界展示。
 */
import { isDynamicImportFailure } from '@openAwork/shared-ui';

const RELOAD_FLAG_PREFIX = 'openAwork:route-import-reload:';

function reloadFlagKey(cacheKey: string): string {
  return `${RELOAD_FLAG_PREFIX}${cacheKey}`;
}

/**
 * 发起一次整页刷新，返回是否已触发。
 *
 * 返回 `true` 时调用方应保持挂起（不要再抛错），否则错误边界会在刷新前闪一屏。
 */
export function reloadOnceForRouteImportFailure(cacheKey: string): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const flagKey = reloadFlagKey(cacheKey);
  try {
    if (window.sessionStorage.getItem(flagKey) === '1') {
      return false;
    }
    window.sessionStorage.setItem(flagKey, '1');
  } catch {
    // 隐私模式 / 存储被禁用时 sessionStorage 会直接抛错：无法去重就不要刷新，
    // 宁可展示错误页也不能冒刷新风暴的风险。
    return false;
  }

  window.location.reload();
  return true;
}

/** 模块加载成功后清掉标记，让下一次（例如下一次依赖重建）仍能自动恢复一次。 */
export function clearRouteImportFailureFlag(cacheKey: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.sessionStorage.removeItem(reloadFlagKey(cacheKey));
  } catch {
    // 存储不可用时标记本来也没写进去，无需清理。
  }
}

export { isDynamicImportFailure };
