import { Component, type ReactElement, type ReactNode } from 'react';

interface MonacoErrorBoundaryProps {
  fallback?: ReactNode;
  children: (mountKey: number) => ReactElement;
}

interface MonacoErrorBoundaryState {
  error: Error | null;
  /** Bumps every time we recover, used as a key to force a fresh mount. */
  mountKey: number;
  /** True after the auto-retry already ran for the current error. */
  autoRetried: boolean;
}

/**
 * Tightly-scoped error boundary for Monaco editor mounts.
 *
 * Background:
 *   React 19 + StrictMode in dev runs the "double-invoke effects" pass on
 *   every mount. `@monaco-editor/react` 4.x's internal Monaco `Editor`
 *   disposes its `InstantiationService` on first cleanup, then the
 *   second mount re-runs the effect against the disposed services and
 *   throws:
 *     "InstantiationService has been disposed"
 *     "Cannot read properties of undefined (reading 'domNode')"
 *
 *   The crash only happens in dev (StrictMode), but it would tear down
 *   the whole tree without a boundary.
 *
 * Recovery strategy:
 *   - Synchronous render-time errors → caught by `componentDidCatch`,
 *     auto-retry once with a bumped `mountKey` to force a fresh
 *     `<MonacoEditor key=...>` and skip the disposed-instance reuse.
 *   - Asynchronous internal errors (Monaco's own setTimeout / rAF
 *     callbacks running after dispose) → can't be caught by React.
 *     A separate global `window.error` filter silences those when the
 *     stack points into Monaco; see installMonacoAsyncErrorFilter.
 *
 *   Production (no StrictMode double-invoke) is unaffected.
 *
 * Children API:
 *   The boundary passes a `mountKey: number` to its render-prop child,
 *   meant to be used as the `key` on the `<MonacoEditor>` element so
 *   each retry creates a fresh React instance (and therefore a fresh
 *   Monaco instance underneath).
 */
export class MonacoErrorBoundary extends Component<
  MonacoErrorBoundaryProps,
  MonacoErrorBoundaryState
> {
  constructor(props: MonacoErrorBoundaryProps) {
    super(props);
    this.state = { error: null, mountKey: 0, autoRetried: false };
  }

  static getDerivedStateFromError(error: Error): Partial<MonacoErrorBoundaryState> {
    return { error };
  }

  override componentDidCatch(error: Error): void {
    // Single auto-retry: bump mountKey, clear error. Most StrictMode
    // dev-mode disposal crashes succeed on the second mount because the
    // double-invoke pass is already done.
    if (!this.state.autoRetried) {
      this.setState((prev) => ({
        error: null,
        mountKey: prev.mountKey + 1,
        autoRetried: true,
      }));
      return;
    }
    // Real failure — log it so it's discoverable.
    // eslint-disable-next-line no-console
    console.warn('[MonacoErrorBoundary] caught after auto-retry', error.message);
  }

  private handleManualRetry = (): void => {
    this.setState((prev) => ({
      error: null,
      mountKey: prev.mountKey + 1,
      autoRetried: false,
    }));
  };

  override render(): ReactNode {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <div
            style={{
              padding: 24,
              fontSize: 12,
              color: 'var(--text-3)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              alignItems: 'flex-start',
            }}
          >
            <span>编辑器加载失败:{this.state.error.message.slice(0, 120)}</span>
            <button
              type="button"
              onClick={this.handleManualRetry}
              style={{
                height: 24,
                padding: '0 12px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text-2)',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              重试
            </button>
          </div>
        )
      );
    }
    return this.props.children(this.state.mountKey);
  }
}

/**
 * Suppress noisy Monaco async errors that fire from setTimeout / rAF
 * after the editor instance was disposed by React's StrictMode double-
 * invoke. These can't be caught by an error boundary because they're
 * not part of any render or effect — they execute on the host browser's
 * task queue. We swallow them silently *only* when the stack frame is
 * obviously inside Monaco's bundle.
 *
 * Also suppresses Monaco CDN/loader script errors that manifest as
 * `Event { type: 'error', target: <script> }` when the loader fails
 * to fetch the Monaco bundle.
 *
 * Idempotent: calling twice is a no-op. Safe to invoke at module load.
 */
let asyncFilterInstalled = false;
export function installMonacoAsyncErrorFilter(): void {
  if (asyncFilterInstalled) return;
  if (typeof window === 'undefined') return;
  asyncFilterInstalled = true;

  const isMonacoStack = (text: string | undefined): boolean => {
    if (!text) return false;
    return /editor\.api[-_].+\.js|monaco-editor|monaco.*loader/i.test(text);
  };

  window.addEventListener('error', (event) => {
    // Script load errors from Monaco's CDN loader
    if (
      event.target instanceof HTMLScriptElement &&
      /monaco/i.test(event.target.src ?? '')
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const message = event.error?.stack ?? event.error?.message ?? event.message;
    if (!isMonacoStack(message)) return;
    // Silence — it's a benign post-dispose race.
    event.preventDefault();
    event.stopImmediatePropagation();
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message =
      typeof reason === 'string'
        ? reason
        : reason?.stack || reason?.message || String(reason ?? '');
    if (!isMonacoStack(message)) return;
    event.preventDefault();
  });
}
