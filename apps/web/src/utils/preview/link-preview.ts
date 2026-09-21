import type { MouseEvent } from 'react';

/**
 * 应用内链接预览请求总线。
 *
 * 需要预览的 http(s) 链接锚点渲染在很深的组件树里（聊天消息、工具输出、文件编辑预览等），
 * 拿不到页面级的预览回调，因此这里沿用项目既有的 window CustomEvent 约定
 * （与 `openawork:browser:open-url` 同形），由当前页面注册监听来「认领」请求。
 * 事件是可取消的：监听方调用 `preventDefault()` 即表示已认领；
 * 若没有任何页面认领（例如产物中心、模板页），锚点保持原生 `target="_blank"` 行为，
 * 保证链接永远不会失效。
 */

/** 应用内链接预览事件的名称，页面监听方据此认领预览请求。 */
export const OPEN_LINK_PREVIEW_EVENT = 'openawork:preview:open-url';

/** 应用内链接预览请求的载荷。 */
export interface OpenLinkPreviewRequest {
  readonly url: string;
}

/**
 * 判断给定 href 是否可交由应用内预览打开。
 *
 * 仅当去除首尾空白后匹配 `^https?://` 时返回 true；
 * `null` / `undefined` / 空串、相对路径（如 `/home`）、`mailto:`、`#anchor` 一律返回 false。
 *
 * 作为类型谓词，调用方在判定通过后可直接把 `href` 当作 `string` 使用。
 */
export function isPreviewableLinkHref(href: string | null | undefined): href is string {
  if (typeof href !== 'string') {
    return false;
  }

  return /^https?:\/\//i.test(href.trim());
}

/**
 * 派发应用内链接预览请求。
 *
 * 非浏览器环境（`typeof window === 'undefined'`）直接返回 false。
 * 否则派发可取消的 `OPEN_LINK_PREVIEW_EVENT` 并返回 `event.defaultPrevented`：
 * 页面监听方调用 `preventDefault()` 即表示认领，返回 true；
 * 无人认领时返回 false，调用方应回退到原生链接行为。
 */
export function requestLinkPreview(url: string): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const event = new CustomEvent<OpenLinkPreviewRequest>(OPEN_LINK_PREVIEW_EVENT, {
    detail: { url },
    cancelable: true,
  });
  window.dispatchEvent(event);

  return event.defaultPrevented;
}

/**
 * 尝试用应用内预览打开被点击的链接。
 *
 * 只有「普通左键单击 + 未按任何修饰键 + 可预览的 http(s) 地址」才会路由到应用内预览；
 * 中键 / Cmd / Ctrl / Shift / Alt / 非 http(s) 链接保持原生行为，
 * 以便用户仍可新标签页打开、下载或跳转锚点。
 */
export function tryOpenLinkPreview(
  event: MouseEvent<HTMLAnchorElement>,
  href: string | undefined,
): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }

  const target = href?.trim();
  if (!isPreviewableLinkHref(target)) {
    return;
  }

  if (requestLinkPreview(target)) {
    event.preventDefault();
  }
}
