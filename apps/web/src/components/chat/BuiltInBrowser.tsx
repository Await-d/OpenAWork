import React, { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

const isTauriEnv = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const DEFAULT_URL = 'http://localhost:3000';

function isLocalhostUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '0.0.0.0' ||
      parsed.hostname === '[::1]'
    );
  } catch {
    return false;
  }
}

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

  // Console panel state
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleEntry[]>([]);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Listen for messages from the iframe (console proxy)
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data && event.data.type === 'oaw-console') {
        const entry: ConsoleEntry = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          level: event.data.level || 'log',
          message: event.data.message || '',
          timestamp: Date.now(),
          source: event.data.source,
        };
        setConsoleLogs((prev) => [...prev.slice(-200), entry]); // Keep last 200 entries
      }
      // Catch iframe errors
      if (event.data && event.data.type === 'oaw-error') {
        const entry: ConsoleEntry = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          level: 'error',
          message: `${event.data.message || 'Error'}${event.data.filename ? ` (${event.data.filename}:${event.data.lineno})` : ''}`,
          timestamp: Date.now(),
          source: event.data.filename,
        };
        setConsoleLogs((prev) => [...prev.slice(-200), entry]);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Auto-scroll console to bottom
  useEffect(() => {
    if (consoleOpen && consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [consoleLogs.length, consoleOpen]);

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

  const errorCount = consoleLogs.filter((l) => l.level === 'error').length;
  const warnCount = consoleLogs.filter((l) => l.level === 'warn').length;

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
          padding: '5px 8px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--header-bg)',
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
            padding: '0 10px',
            borderRadius: 13,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg)',
            color: 'var(--text)',
            fontSize: 11,
            outline: 'none',
            fontFamily: 'var(--font-mono, monospace)',
            transition: 'border-color 100ms ease, box-shadow 100ms ease',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'var(--accent)';
            e.currentTarget.style.boxShadow = '0 0 0 2px var(--accent-muted)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-subtle)';
            e.currentTarget.style.boxShadow = 'none';
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
        {/* Console toggle button */}
        <button
          type="button"
          title={consoleOpen ? '关闭控制台' : '打开控制台'}
          onClick={() => setConsoleOpen((v) => !v)}
          style={{
            width: 26,
            height: 26,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: consoleOpen
              ? '1px solid var(--accent)'
              : errorCount > 0
                ? '1px solid var(--danger)'
                : '1px solid var(--border-subtle)',
            borderRadius: 6,
            background: consoleOpen
              ? 'color-mix(in oklch, var(--accent) 12%, transparent)'
              : errorCount > 0
                ? 'color-mix(in oklch, var(--danger) 8%, transparent)'
                : 'transparent',
            color:
              errorCount > 0 ? 'var(--danger)' : consoleOpen ? 'var(--accent)' : 'var(--text-2)',
            cursor: 'pointer',
            flexShrink: 0,
            fontSize: 0,
            position: 'relative',
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M7 15h4" />
            <path d="M7 9l3 3-3 3" />
          </svg>
          {/* Error/warn badge */}
          {(errorCount > 0 || warnCount > 0) && (
            <span
              style={{
                position: 'absolute',
                top: -3,
                right: -3,
                minWidth: 12,
                height: 12,
                borderRadius: 6,
                background: errorCount > 0 ? 'var(--danger)' : 'var(--warning)',
                color: 'var(--accent-text)',
                fontSize: 8,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 2px',
              }}
            >
              {errorCount || warnCount}
            </span>
          )}
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
                <span style={{ color: 'var(--danger)', fontWeight: 600 }}>Webview 创建失败</span>
                <span style={{ maxWidth: 260, wordBreak: 'break-word' }}>{webviewError}</span>
              </div>
            )}
          </>
        ) : (
          <>
            <iframe
              ref={iframeRef}
              key={refreshKey}
              src={activeUrl}
              title="内置浏览器"
              sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-popups-to-escape-sandbox"
              referrerPolicy="no-referrer"
              allow="clipboard-read; clipboard-write"
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                border: 'none',
              }}
              onLoad={() => {
                // Inject console proxy into the iframe
                try {
                  const iframeWindow = iframeRef.current?.contentWindow;
                  if (iframeWindow) {
                    injectConsoleProxy(iframeWindow);
                  }
                } catch {
                  // Cross-origin — can't inject, that's fine
                  setConsoleLogs((prev) => [
                    ...prev,
                    {
                      id: `${Date.now()}-info`,
                      level: 'info',
                      message: `页面已加载: ${activeUrl}（跨域页面无法捕获控制台输出）`,
                      timestamp: Date.now(),
                    },
                  ]);
                }
              }}
              onError={() => {
                setConsoleLogs((prev) => [
                  ...prev,
                  {
                    id: `${Date.now()}-err`,
                    level: 'error',
                    message: `无法加载: ${activeUrl}`,
                    timestamp: Date.now(),
                  },
                ]);
              }}
            />
            {activeUrl && !isLocalhostUrl(activeUrl) && !consoleOpen && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 8,
                  left: 8,
                  right: 8,
                  padding: '6px 10px',
                  borderRadius: 6,
                  background: 'color-mix(in oklch, var(--surface) 95%, var(--warning) 5%)',
                  border: '1px solid color-mix(in oklch, var(--warning) 30%, var(--border))',
                  fontSize: 10,
                  color: 'var(--text-2)',
                  pointerEvents: 'none',
                  opacity: 0.9,
                }}
              >
                💡 提示：大多数外部网站禁止在 iframe 中加载。本地开发服务器（localhost）可正常预览。
              </div>
            )}
          </>
        )}
      </div>

      {/* Console panel */}
      {consoleOpen && (
        <BrowserConsolePanel
          logs={consoleLogs}
          endRef={consoleEndRef}
          onClear={() => setConsoleLogs([])}
          onClose={() => setConsoleOpen(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Console Panel Types & Components
// ---------------------------------------------------------------------------

interface ConsoleEntry {
  id: string;
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  message: string;
  timestamp: number;
  source?: string;
}

const LEVEL_COLORS: Record<ConsoleEntry['level'], string> = {
  log: 'var(--text-2)',
  info: 'var(--accent)',
  warn: 'var(--warning)',
  error: 'var(--danger)',
  debug: 'oklch(0.7 0.16 290)',
};

const LEVEL_BG: Record<ConsoleEntry['level'], string> = {
  log: 'transparent',
  info: 'transparent',
  warn: 'color-mix(in oklch, var(--warning) 6%, transparent)',
  error: 'color-mix(in oklch, var(--danger) 6%, transparent)',
  debug: 'transparent',
};

function BrowserConsolePanel({
  logs,
  endRef,
  onClear,
  onClose,
}: {
  logs: ConsoleEntry[];
  endRef: React.RefObject<HTMLDivElement | null>;
  onClear: () => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<ConsoleEntry['level'] | 'all'>('all');

  const filteredLogs = filter === 'all' ? logs : logs.filter((l) => l.level === filter);
  const errorCount = logs.filter((l) => l.level === 'error').length;
  const warnCount = logs.filter((l) => l.level === 'warn').length;

  return (
    <div
      data-testid="browser-console-panel"
      style={{
        flexShrink: 0,
        height: 'clamp(120px, 28vh, 220px)',
        display: 'flex',
        flexDirection: 'column',
        borderTop: '1px solid var(--border)',
        background: 'var(--bg)',
      }}
    >
      {/* Console toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-2)', marginRight: 4 }}>
          控制台
        </span>

        {/* Level filter pills */}
        <FilterPill
          label="全部"
          count={logs.length}
          active={filter === 'all'}
          onClick={() => setFilter('all')}
        />
        <FilterPill
          label="错误"
          count={errorCount}
          active={filter === 'error'}
          onClick={() => setFilter('error')}
          color="var(--danger)"
        />
        <FilterPill
          label="警告"
          count={warnCount}
          active={filter === 'warn'}
          onClick={() => setFilter('warn')}
          color="var(--warning)"
        />
        <FilterPill
          label="日志"
          count={logs.filter((l) => l.level === 'log').length}
          active={filter === 'log'}
          onClick={() => setFilter('log')}
        />

        <div style={{ flex: 1 }} />

        <button
          type="button"
          onClick={onClear}
          title="清空控制台"
          style={{
            height: 20,
            padding: '0 6px',
            borderRadius: 4,
            border: '1px solid var(--border-subtle)',
            background: 'transparent',
            color: 'var(--text-3)',
            fontSize: 9,
            cursor: 'pointer',
          }}
        >
          清空
        </button>
        <button
          type="button"
          onClick={onClose}
          title="关闭控制台"
          style={{
            width: 20,
            height: 20,
            borderRadius: 4,
            border: 'none',
            background: 'transparent',
            color: 'var(--text-3)',
            fontSize: 11,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ✕
        </button>
      </div>

      {/* Console output */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '2px 0',
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: 11,
          lineHeight: 1.5,
        }}
      >
        {filteredLogs.length === 0 ? (
          <div
            style={{
              padding: '16px',
              textAlign: 'center',
              color: 'var(--text-4)',
              fontSize: 11,
            }}
          >
            {logs.length === 0 ? '暂无控制台输出' : '当前过滤条件下无匹配'}
          </div>
        ) : (
          filteredLogs.map((entry) => (
            <div
              key={entry.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 6,
                padding: '2px 8px',
                borderBottom:
                  '1px solid color-mix(in oklch, var(--border-subtle) 50%, transparent)',
                background: LEVEL_BG[entry.level],
                minHeight: 20,
              }}
            >
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  color: LEVEL_COLORS[entry.level],
                  textTransform: 'uppercase',
                  width: 32,
                  flexShrink: 0,
                  paddingTop: 2,
                }}
              >
                {entry.level === 'error'
                  ? '❌'
                  : entry.level === 'warn'
                    ? '⚠️'
                    : entry.level === 'info'
                      ? 'ℹ️'
                      : '›'}
              </span>
              <span
                style={{
                  flex: 1,
                  color: LEVEL_COLORS[entry.level],
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {entry.message}
              </span>
              <span
                style={{
                  fontSize: 9,
                  color: 'var(--text-4)',
                  flexShrink: 0,
                  paddingTop: 2,
                }}
              >
                {formatTime(entry.timestamp)}
              </span>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function FilterPill({
  label,
  count,
  active,
  onClick,
  color,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 18,
        padding: '0 5px',
        borderRadius: 9,
        border: active ? `1px solid ${color || 'var(--accent)'}` : '1px solid var(--border-subtle)',
        background: active
          ? `color-mix(in oklch, ${color || 'var(--accent)'} 12%, transparent)`
          : 'transparent',
        color: active ? color || 'var(--accent)' : 'var(--text-3)',
        fontSize: 9,
        fontWeight: 500,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
      }}
    >
      {label}
      {count > 0 && <span style={{ fontWeight: 700 }}>{count}</span>}
    </button>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

/**
 * Inject a console proxy into the iframe window that forwards
 * console.log/warn/error/info to the parent via postMessage.
 * Also hooks window.onerror for uncaught exceptions.
 */
function injectConsoleProxy(iframeWindow: Window): void {
  try {
    const script = iframeWindow.document.createElement('script');
    script.textContent = `
      (function() {
        var origConsole = {
          log: console.log,
          info: console.info,
          warn: console.warn,
          error: console.error,
          debug: console.debug
        };
        function stringify(args) {
          return Array.from(args).map(function(a) {
            if (a === null) return 'null';
            if (a === undefined) return 'undefined';
            if (typeof a === 'object') {
              try { return JSON.stringify(a, null, 2); } catch(e) { return String(a); }
            }
            return String(a);
          }).join(' ');
        }
        ['log','info','warn','error','debug'].forEach(function(level) {
          console[level] = function() {
            origConsole[level].apply(console, arguments);
            try {
              parent.postMessage({ type: 'oaw-console', level: level, message: stringify(arguments) }, '*');
            } catch(e) {}
          };
        });
        window.onerror = function(msg, source, lineno, colno, error) {
          parent.postMessage({
            type: 'oaw-error',
            message: String(msg),
            filename: source || '',
            lineno: lineno || 0
          }, '*');
        };
        window.addEventListener('unhandledrejection', function(e) {
          parent.postMessage({
            type: 'oaw-error',
            message: 'Unhandled Promise Rejection: ' + (e.reason ? String(e.reason.message || e.reason) : 'unknown'),
            filename: '',
            lineno: 0
          }, '*');
        });
      })();
    `;
    iframeWindow.document.head.appendChild(script);
  } catch {
    // Cross-origin — can't inject
  }
}
