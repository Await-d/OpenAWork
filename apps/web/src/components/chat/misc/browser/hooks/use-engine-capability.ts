/**
 * 浏览器预览两种引擎的能力矩阵。
 *
 * 面板需要根据「当前用哪种引擎、目标页是否同源、网关侧实时引擎能做什么」决定哪些
 * 操作可用（读 DOM / 截图 / 实时画面）。把这段判断抽成纯函数，组件只消费结果，也
 * 便于在单测里把各路组合钉死。
 *
 * 两个容易混淆的能力位必须分开：
 * - 「实时引擎可用」（`liveAvailable`）：网关能把 CDP 会话跑起来，截图、元素拾取、
 *   computed styles 这些按需命令都可用；
 * - 「可实时画面」（`liveView`）：还要求 screencast 受支持——只有 Chromium 有
 *   （`BrowserLiveSession.supportsScreencast()`），非 Chromium 引擎能截图但不能推流。
 *
 * Tauri 原生 webview 是「只显示」表面：画面由系统 webview 渲染，实时通道只用于
 * 控制台 / 网络采集、不接管画面，所以即使探测到实时引擎，也不能在这里宣称可读
 * DOM / 截图 / 实时预览。
 */

export type BrowserEngineKind = 'tauri-webview' | 'iframe';

export interface BrowserEngineCapability {
  engine: BrowserEngineKind;
  sameOrigin: boolean;
  domEval: boolean;
  screenshot: boolean;
  liveView: boolean;
  limitations: string[];
}

export interface UseEngineCapabilityOptions {
  engine: BrowserEngineKind;
  url: string | null;
  /**
   * 网关 CDP 实时引擎（网关 `/browser-live`）是否可用，对应状态里的
   * `availability.available`。可用时截图与元素拾取 / computed styles 都在网关侧
   * 读取 DOM——因此 `domEval` 同样视为可用，且不受同源策略限制。
   */
  liveAvailable?: boolean;
  /**
   * 实时引擎是否支持 screencast，对应 `availability.screencast`（仅 Chromium）。
   * 缺省与 `liveAvailable` 相同，便于只关心「有没有实时引擎」的调用方；宿主必须
   * 传网关的真实值，否则非 Chromium 引擎会被误报为可实时预览。
   */
  liveScreencast?: boolean;
}

/** 解析 URL 的 origin；相对路径用 base 解析，非法值返回 null 而不是抛错。 */
function resolveOrigin(url: string | null, base: string): string | null {
  if (!url) return null;
  try {
    return base ? new URL(url, base).origin : new URL(url).origin;
  } catch {
    // 非法 URL（如 `http://`）——按「无法判定为同源」处理即可。
    return null;
  }
}

/**
 * 计算某引擎 + 目标地址下的能力。
 *
 * 语义：
 * - `sameOrigin`：URL 的 origin 等于 `appOrigin`；
 * - `domEval`：同源 iframe 可在页面内执行脚本；CDP 实时引擎在网关侧读取 DOM
 *   （元素拾取 / computed styles），因此 `liveAvailable` 为真时同样视为可用；
 * - `screenshot`：由实时引擎提供（Playwright `page.screenshot`，不依赖 screencast）；
 * - `liveView`：由 screencast 提供，仅 Chromium（`liveScreencast`）；
 * - `tauri-webview`：实时通道不接管画面（仅采集控制台 / 网络），三个实时能力位一律为 false。
 */
export function computeEngineCapability(
  engine: BrowserEngineKind,
  url: string | null,
  appOrigin: string,
  liveAvailable = false,
  liveScreencast = liveAvailable,
): BrowserEngineCapability {
  const targetOrigin = resolveOrigin(url, appOrigin);
  const sameOrigin = appOrigin.length > 0 && targetOrigin !== null && targetOrigin === appOrigin;
  const liveUsable = liveAvailable && engine === 'iframe';
  const iframeDomEval = sameOrigin && engine === 'iframe';
  const domEval = iframeDomEval || liveUsable;

  const screenshot = liveUsable;
  const liveView = liveUsable && liveScreencast;

  const limitations: string[] = [];
  if (!domEval) {
    if (!sameOrigin) {
      limitations.push('跨域页面无法读取 DOM');
    } else {
      limitations.push(`当前引擎（${engine}）不支持 DOM 求值`);
    }
  }
  if (!screenshot) limitations.push('当前引擎不支持截图');
  if (!liveView) {
    limitations.push(
      liveUsable && !liveScreencast
        ? '当前实时引擎不支持 screencast（仅 Chromium 可实时预览）'
        : '实时 CDP 调试尚未接入',
    );
  }

  return { engine, sameOrigin, domEval, screenshot, liveView, limitations };
}

/** 面板用的薄 hook：从当前页面读取 `appOrigin`，其余交给纯函数。 */
export function useEngineCapability({
  engine,
  url,
  liveAvailable = false,
  liveScreencast = liveAvailable,
}: UseEngineCapabilityOptions): BrowserEngineCapability {
  const appOrigin = typeof window === 'undefined' ? '' : window.location.origin;
  return computeEngineCapability(engine, url, appOrigin, liveAvailable, liveScreencast);
}
