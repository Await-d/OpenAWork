/**
 * `useTauriWebview` — 内置浏览器的 Tauri 原生 webview 生命周期。
 *
 * 从 `BuiltInBrowser.tsx` 抽出：负责创建 / 销毁绑定当前 url 的原生 webview、
 * 在容器可见性变化时同步位置，并把就绪 / 错误状态回传给宿主。非 Tauri 环境
 * （web 端 iframe）不参与，effect 内部自行提前返回。
 */

import { useEffect, useRef, useState, type RefObject } from 'react';

interface UseTauriWebviewParams {
  isTauri: boolean;
  activeUrl: string;
  refreshKey: number;
  hidden: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  internalNavRef: RefObject<{ tabId: string; url: string } | null>;
  activeTabIdRef: RefObject<string>;
  generationRef: RefObject<number>;
}

export function useTauriWebview({
  isTauri,
  activeUrl,
  refreshKey,
  hidden,
  containerRef,
  internalNavRef,
  activeTabIdRef,
  generationRef,
}: UseTauriWebviewParams): { webviewReady: boolean; webviewError: string | null } {
  const [webviewReady, setWebviewReady] = useState(false);
  const [webviewError, setWebviewError] = useState<string | null>(null);
  const activeWebviewRef = useRef<any>(null);
  const tauriDpiRef = useRef<{ LogicalPosition: any; LogicalSize: any } | null>(null);

  // ── Tauri native webview lifecycle ──────────────────────────────────
  useEffect(() => {
    if (!isTauri || !containerRef.current || !activeUrl) return;

    // 内部 navigate 同步:iframe/webview 已经在新 url,只是 React state 落后。
    // 这种情况不要重建 webview(否则页面状态丢失)。
    const internalNav = internalNavRef.current;
    if (
      internalNav &&
      internalNav.tabId === activeTabIdRef.current &&
      internalNav.url === activeUrl
    ) {
      internalNavRef.current = null;
      return;
    }

    const gen = ++generationRef.current;
    let webview: any = null;
    let observer: ResizeObserver | null = null;
    let rafId = 0;
    let disposed = false;

    setWebviewReady(false);
    setWebviewError(null);

    async function create() {
      try {
        const [{ Webview }, { getCurrentWindow }, dpi] = await Promise.all([
          import('@tauri-apps/api/webview'),
          import('@tauri-apps/api/window'),
          import('@tauri-apps/api/dpi'),
        ]);

        const { LogicalPosition, LogicalSize } = dpi;
        if (disposed || gen !== generationRef.current) return;
        tauriDpiRef.current = { LogicalPosition, LogicalSize };

        const container = containerRef.current;
        if (!container) return;

        const appWindow = getCurrentWindow();
        let rect = container.getBoundingClientRect();

        // 容器尚未完成布局(display:none 或零尺寸)时,用 ResizeObserver 等待
        // 它变为可见且有尺寸后再创建 webview,避免 Tauri 原生 webview 初始化失败。
        if (rect.width < 1 || rect.height < 1) {
          await new Promise<void>((resolve) => {
            const wait = new ResizeObserver(() => {
              const r = container.getBoundingClientRect();
              if (r.width >= 1 && r.height >= 1) {
                wait.disconnect();
                resolve();
              }
            });
            wait.observe(container);
            // 安全超时:5s 后即使容器仍零尺寸也继续(用 Math.max 兜底)。
            const timer = setTimeout(() => {
              wait.disconnect();
              resolve();
            }, 5000);
            // 清理:组件卸载或 generation 变化时中止等待。
            const check = setInterval(() => {
              if (disposed || gen !== generationRef.current) {
                clearInterval(check);
                clearTimeout(timer);
                wait.disconnect();
                resolve();
              }
            }, 200);
          });
          if (disposed || gen !== generationRef.current) return;
          rect = container.getBoundingClientRect();
        }

        const label = `browser-${Date.now().toString(36)}`;

        webview = new Webview(appWindow, label, {
          url: activeUrl,
          x: rect.x,
          y: rect.y,
          width: Math.max(rect.width, 100),
          height: Math.max(rect.height, 100),
          focus: false,
        });

        webview.once('tauri://created', () => {
          if (disposed || gen !== generationRef.current) {
            if (webview) {
              webview.close().catch(() => {});
              webview = null;
            }
            return;
          }

          activeWebviewRef.current = webview;
          setWebviewReady(true);

          const syncPosition = () => {
            if (!webview || !container) return;
            const r = container.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) {
              webview.setPosition(new LogicalPosition(-9999, -9999)).catch(() => {});
              return;
            }
            webview.setPosition(new LogicalPosition(r.x, r.y)).catch(() => {});
            webview
              .setSize(new LogicalSize(Math.max(r.width, 1), Math.max(r.height, 1)))
              .catch(() => {});
          };

          observer = new ResizeObserver(() => {
            if (disposed) return;
            cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(syncPosition);
          });
          observer.observe(container);
        });

        webview.once('tauri://error', (e: unknown) => {
          if (disposed || gen !== generationRef.current) return;
          const raw =
            typeof e === 'object' && e !== null && 'payload' in e
              ? (e as Record<string, unknown>).payload
              : e;
          const msg =
            raw instanceof Error
              ? raw.message
              : typeof raw === 'object' && raw !== null && 'message' in raw
                ? String((raw as Record<string, unknown>).message)
                : typeof raw === 'string'
                  ? raw
                  : String(raw);
          console.error('[BuiltInBrowser] webview error:', msg);
          webview = null;
          activeWebviewRef.current = null;
          setWebviewError(msg);
        });
      } catch (err) {
        if (!disposed && gen === generationRef.current) {
          const msg =
            err instanceof Error
              ? err.message
              : typeof err === 'object' && err !== null && 'message' in err
                ? String((err as Record<string, unknown>).message)
                : String(err);
          console.error('[BuiltInBrowser] init error:', msg);
          setWebviewError(msg);
        }
      }
    }

    void create();

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      activeWebviewRef.current = null;
      if (webview) {
        webview.close().catch(() => {});
        webview = null;
      }
    };
  }, [isTauri, activeUrl, refreshKey]);

  // ── 切 tab 不重建 webview 的优化:Tauri webview 仍然要重建,因为它绑定 url。
  // 已通过 activeUrl 依赖驱动。

  // ── Visibility toggle ───────────────────────────────────────────────
  useEffect(() => {
    if (!isTauri) return;
    const wv = activeWebviewRef.current;
    const dpi = tauriDpiRef.current;
    if (!wv || !dpi) return;

    if (hidden) {
      wv.setPosition(new dpi.LogicalPosition(-9999, -9999)).catch(() => {});
    } else {
      const container = containerRef.current;
      if (!container) return;
      const r = container.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        wv.setPosition(new dpi.LogicalPosition(r.x, r.y)).catch(() => {});
        wv.setSize(new dpi.LogicalSize(Math.max(r.width, 1), Math.max(r.height, 1))).catch(
          () => {},
        );
      }
    }
  }, [isTauri, hidden]);

  return { webviewReady, webviewError };
}
