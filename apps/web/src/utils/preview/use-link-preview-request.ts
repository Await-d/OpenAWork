import { useEffect, useRef } from 'react';
import { OPEN_LINK_PREVIEW_EVENT, type OpenLinkPreviewRequest } from './link-preview.js';

/**
 * 注册「点击链接 → 打开应用内预览」的处理器。
 *
 * `enabled` 用于 CachedRouteOutlet 的激活守卫：被缓存但当前不可见的页面不得响应，
 * 否则同一事件会被多个同时挂载的页面重复认领。处理器通过引用读取，避免每次渲染
 * 重新订阅。
 */
export function useLinkPreviewRequest(enabled: boolean, handler: (url: string) => void): void {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<OpenLinkPreviewRequest>).detail;
      const url = detail?.url?.trim();
      if (!url) return;
      handlerRef.current(url);
      event.preventDefault();
    };
    window.addEventListener(OPEN_LINK_PREVIEW_EVENT, onRequest);
    return () => window.removeEventListener(OPEN_LINK_PREVIEW_EVENT, onRequest);
  }, [enabled]);
}
