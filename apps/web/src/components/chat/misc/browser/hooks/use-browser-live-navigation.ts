/**
 * Tauri 原生窗口的实时采集导航同步。
 *
 * 原生窗口的画面由系统 webview 渲染，网关侧 CDP 页面不会被 `CdpLiveEngine`
 * 挂载——没有这段接线，实时引擎采集到的永远是空白页。本 hook 把当前标签页的
 * URL / 刷新信号下发给远端页面，语义与 `CdpLiveEngine` 的导航 effect 完全一致
 * （同一 URL 只导航一次、`about:blank` 等非 http(s) 地址跳过、未建连时进待发
 * 队列由通道就绪后补发）。
 *
 * 为什么单独成 hook 而不是复用引擎组件：引擎组件同时负责 screencast 渲染与
 * 输入回传，Tauri 下这两项都不需要（画面是原生 webview，输入走系统 webview），
 * 挂载它只会白白产帧、白白 ack。
 */

import { useEffect, useRef } from 'react';

import { NAVIGABLE_URL_PATTERN } from '../browser-url.js';
import type { BrowserLiveSession } from './use-browser-live-session.js';

export interface UseBrowserLiveNavigationOptions {
  /** 与控制台采集共用同一条实时会话（订阅扇出，不新开连接）。 */
  session: BrowserLiveSession;
  /**
   * 是否需要本 hook 接管导航。仅当 `CdpLiveEngine` 没有挂载时启用：
   * 实时引擎接管画面时由引擎自己同步 URL，两边同时下发会对同一 URL
   * 触发两次导航（页面被加载两次）。宿主还会叠加可见性（`hidden`）——
   * 不可见的预览不下发导航，重新可见时补发当前地址。
   */
  enabled: boolean;
  /** 当前标签页 URL。 */
  url: string;
  /** 工具栏刷新信号；变化即让远端 reload，与原生 webview 的重载保持同步。 */
  refreshKey: number;
}

export function useBrowserLiveNavigation({
  session,
  enabled,
  url,
  refreshKey,
}: UseBrowserLiveNavigationOptions): void {
  const { send } = session;
  /** 已下发导航的 URL；同一 URL 不重复导航。 */
  const navigatedUrlRef = useRef<string | null>(null);
  const lastRefreshKeyRef = useRef(refreshKey);

  // 首次进入 / 地址变更：让远端跟随当前标签页的 URL。
  useEffect(() => {
    if (!enabled) return;
    if (navigatedUrlRef.current === url) return;
    navigatedUrlRef.current = url;
    if (!NAVIGABLE_URL_PATTERN.test(url)) return;
    send({ ch: 'control', action: 'navigate', url });
  }, [enabled, url, send]);

  // 刷新信号：远端页面与原生 webview 一起重载，避免采集到的是旧页面。
  useEffect(() => {
    if (!enabled) return;
    if (lastRefreshKeyRef.current === refreshKey) return;
    lastRefreshKeyRef.current = refreshKey;
    send({ ch: 'control', action: 'reload' });
  }, [enabled, refreshKey, send]);
}
