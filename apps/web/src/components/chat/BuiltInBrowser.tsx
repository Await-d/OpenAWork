import React, { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

const isTauriEnv = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const DEFAULT_URL = 'https://www.bing.com';

interface BuiltInBrowserProps {
  className?: string;
  style?: CSSProperties;
  /** When set, the browser navigates to this URL automatically (e.g. from dev-server detection). */
  previewUrl?: string | null;
  /**
   * When true the browser is kept alive but visually hidden (Tauri webview
   * is moved off-screen; iframe wrapper gets `display:none`).  This allows
   * the parent to keep the component mounted across tab switches so page
   * state (scroll, forms, auth) is preserved.
   */
  hidden?: boolean;
}

export function BuiltInBrowser({
  className,
  style,
  previewUrl,
  hidden = false,
}: BuiltInBrowserProps) {
  const initialUrl = previewUrl || DEFAULT_URL;
  const [addressInput, setAddressInput] = useState(initialUrl);
  const [activeUrl, setActiveUrl] = useState(initialUrl);
  const appliedPreviewUrlRef = useRef<string | null>(null);

  // When previewUrl changes externally, navigate to it
  useEffect(() => {
    if (previewUrl && previewUrl !== appliedPreviewUrlRef.current) {
      appliedPreviewUrlRef.current = previewUrl;
      setAddressInput(previewUrl);
      setActiveUrl(previewUrl);
    }
  }, [previewUrl]);

  const [isTauri] = useState(isTauriEnv);
  const [webviewReady, setWebviewReady] = useState(false);
  const [webviewError, setWebviewError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Generation counter — incremented each time the lifecycle effect fires
  // so stale async callbacks can detect they belong to an outdated cycle.
  const generationRef = useRef(0);

  // Cross-effect refs: the lifecycle effect owns creation/destruction via
  // local closure variables, but also publishes the webview instance and
  // cached Tauri DPI constructors so the *visibility* effect can
  // reposition the webview without re-importing modules.
  const activeWebviewRef = useRef<any>(null);
  const tauriDpiRef = useRef<{ LogicalPosition: any; LogicalSize: any } | null>(null);

  const normalizeUrl = useCallback((raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return DEFAULT_URL;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^[a-z0-9-]+\.[a-z]{2,}/i.test(trimmed)) return `https://${trimmed}`;
    return `https://www.bing.com/search?q=${encodeURIComponent(trimmed)}`;
  }, []);

  const handleNavigate = useCallback(
    (urlOrQuery?: string) => {
      const next = normalizeUrl(urlOrQuery ?? addressInput);
      setAddressInput(next);
      setActiveUrl(next);
    },
    [addressInput, normalizeUrl],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleNavigate();
      }
    },
    [handleNavigate],
  );

  // ── Tauri native webview lifecycle ──────────────────────────────────
  // Each effect invocation owns its webview + ResizeObserver via local
  // closure variables.  This guarantees cleanup always reaches the exact
  // resources created by that invocation — no orphan leaks.
  //
  // `refreshKey` in the dependency list lets the refresh button force a
  // destroy-and-recreate cycle without the fragile `setActiveUrl('')` +
  // `requestAnimationFrame` trick that relied on React batching timing.
  useEffect(() => {
    if (!isTauri || !containerRef.current || !activeUrl) return;

    const gen = ++generationRef.current;

    // Local resources owned by THIS effect invocation
    let webview: any = null;
    let observer: ResizeObserver | null = null;
    let rafId = 0;
    let disposed = false;

    setWebviewReady(false);
    setWebviewError(null);

    async function create() {
      try {
        // Dynamic import so pure-web builds never pull Tauri modules
        const [{ Webview }, { getCurrentWindow }, dpi] = await Promise.all([
          import('@tauri-apps/api/webview'),
          import('@tauri-apps/api/window'),
          import('@tauri-apps/api/dpi'),
        ]);

        const { LogicalPosition, LogicalSize } = dpi;

        // Stale check — a newer effect may have already started
        if (disposed || gen !== generationRef.current) return;

        // Cache DPI constructors for the visibility effect
        tauriDpiRef.current = { LogicalPosition, LogicalSize };

        const container = containerRef.current;
        if (!container) return;

        const appWindow = getCurrentWindow();
        const rect = container.getBoundingClientRect();
        const label = `browser-${Date.now().toString(36)}`;

        // Create the native webview.  We capture the reference
        // *immediately* so the cleanup closure can always close it,
        // even if tauri://created hasn't fired yet.
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
            // Effect was cleaned up while the native webview was
            // initialising.  Close it — but only if cleanup hasn't
            // already nulled + closed the local variable.
            if (webview) {
              webview.close().catch(() => {});
              webview = null;
            }
            return;
          }

          // Publish for visibility effect
          activeWebviewRef.current = webview;
          setWebviewReady(true);

          // ResizeObserver keeps the overlay in sync with the DOM
          // placeholder.  Debounce via rAF to avoid IPC spam during
          // continuous resizes (e.g. dragging the panel divider).
          const syncPosition = () => {
            if (!webview || !container) return;
            const r = container.getBoundingClientRect();
            // Container hidden (display:none) → zero rect → move off-screen
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
          const msg = e instanceof Error ? e.message : String(e);
          console.error('[BuiltInBrowser] webview error:', msg);
          // Creation failed — native resource doesn't exist
          webview = null;
          activeWebviewRef.current = null;
          setWebviewError(msg);
        });
      } catch (err) {
        if (!disposed && gen === generationRef.current) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('[BuiltInBrowser] init error:', msg);
          setWebviewError(msg);
        }
      }
    }

    void create();

    // Cleanup: deterministically release all resources owned by this
    // effect invocation.  Because `webview` and `observer` are local
    // variables captured by THIS closure, there is no risk of
    // accidentally closing a resource belonging to a different invocation.
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

  // ── Visibility toggle ───────────────────────────────────────────────
  // When the parent hides/shows us (tab switch), reposition the native
  // Tauri webview off-screen / back to its container.  This avoids
  // destroying the webview (preserving page state) while preventing it
  // from floating over other tab content (native overlay ignores CSS).
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

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        gap: 0,
        ...style,
      }}
    >
      {/* Address bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '6px 6px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'color-mix(in oklch, var(--surface) 94%, var(--bg) 6%)',
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          title="刷新"
          onClick={() => setRefreshKey((k) => k + 1)}
          style={{
            width: 26,
            height: 26,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid var(--border-subtle)',
            borderRadius: 6,
            background: 'transparent',
            color: 'var(--text-2)',
            cursor: 'pointer',
            flexShrink: 0,
            fontSize: 0,
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12a9 9 0 1 1-9-9c2.5 0 4.8 1 6.5 2.6" />
            <path d="M21 3v6h-6" />
          </svg>
        </button>
        <input
          type="text"
          value={addressInput}
          onChange={(e) => setAddressInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入网址或搜索…"
          style={{
            flex: 1,
            minWidth: 0,
            height: 26,
            padding: '0 8px',
            borderRadius: 6,
            border: '1px solid var(--border-subtle)',
            background: 'var(--surface)',
            color: 'var(--text)',
            fontSize: 11.5,
            outline: 'none',
            fontFamily: 'var(--font-mono, monospace)',
          }}
        />
        <button
          type="button"
          onClick={() => handleNavigate()}
          style={{
            height: 26,
            padding: '0 10px',
            borderRadius: 6,
            border: '1px solid color-mix(in oklch, var(--accent) 30%, var(--border))',
            background: 'color-mix(in oklch, var(--accent) 14%, var(--surface))',
            color: 'var(--accent)',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          前往
        </button>
      </div>

      {/* Webview / iframe area */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {isTauri ? (
          // Tauri: native webview is overlaid on this container by the effect above.
          // Show a placeholder until webview is ready or if error.
          <>
            {!webviewReady && !webviewError && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-3)',
                  fontSize: 12,
                }}
              >
                正在加载 Webview…
              </div>
            )}
            {webviewError && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: 16,
                  color: 'var(--text-3)',
                  fontSize: 11,
                  textAlign: 'center',
                }}
              >
                <span style={{ color: '#ef4444', fontWeight: 600 }}>Webview 创建失败</span>
                <span style={{ maxWidth: 260, wordBreak: 'break-word' }}>{webviewError}</span>
              </div>
            )}
          </>
        ) : (
          // Web fallback: iframe (hidden via display:none preserves page state)
          <iframe
            src={activeUrl}
            title="内置浏览器"
            sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              border: 'none',
            }}
          />
        )}
      </div>
    </div>
  );
}
