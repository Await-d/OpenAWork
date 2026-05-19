import { Suspense, useState, useEffect, createContext, useContext, useRef } from 'react';
import type { ComponentType, LazyExoticComponent, MutableRefObject } from 'react';

export type OpenFileFn = (path: string) => void;
export const FileEditorContext = createContext<MutableRefObject<OpenFileFn | null>>({
  current: null,
} as MutableRefObject<OpenFileFn | null>);
export function useFileEditorContext() {
  return useContext(FileEditorContext);
}
import { Routes, Route, Navigate, useNavigate } from 'react-router';
import { UnlockOverlay } from './components/common/UnlockOverlay.js';
import { tauriInvoke } from './pages/settings/shared/settings-page-helpers.js';
import { useAuthStore } from './stores/auth.js';
import LoginPage from './pages/misc/LoginPage.js';
import Layout from './components/Layout.js';
import OnboardingModal from './components/onboarding/OnboardingModal.js';
import PageTransitionLoader from './components/common/PageTransitionLoader.js';
import { ToastContainer } from './components/common/ToastNotification.js';
import UpdateBanner from './components/common/UpdateBanner.js';
import { usePrefersReducedMotion } from './hooks/usePrefersReducedMotion.js';
import { PRELOADABLE_ROUTE_MODULES } from './routes/preloadable-route-modules.js';
import { TelemetryConsentModal } from '@openAwork/shared-ui';
import {
  authenticateDesktopGateway,
  DESKTOP_DEFAULT_EMAIL,
  DESKTOP_GATEWAY_MODE_KEY,
  isTauriRuntime,
  localGatewayUrl,
  readDesktopGatewayMode,
  startDesktopGateway,
  waitForGatewayHealth,
} from './utils/gateway/desktop-gateway.js';

type UnlistenFn = () => void;

interface TauriEvent<T> {
  payload: T;
}

interface TauriEventApi {
  listen<T>(event: string, handler: (event: TauriEvent<T>) => void): Promise<UnlistenFn>;
}

const TAURI_EVENT_MODULE = ['@tauri-apps', 'api', 'event'].join('/');

async function listenTauriEvent<T>(
  event: string,
  handler: (event: TauriEvent<T>) => void,
): Promise<UnlistenFn> {
  const api = (await import(/* @vite-ignore */ TAURI_EVENT_MODULE)) as TauriEventApi;
  return api.listen(event, handler);
}

type Theme = 'dark' | 'light';

interface LazyRoutePageProps {
  component: LazyExoticComponent<ComponentType>;
  prefersReducedMotion: boolean;
  title: string;
}

function LazyRoutePage({ component: Component, prefersReducedMotion, title }: LazyRoutePageProps) {
  return (
    <Suspense
      fallback={
        <PageTransitionLoader
          variant="overlay"
          caption="按需加载中"
          title={title}
          description="当前页面按需加载资源，已优先保证主界面更快可交互。"
          prefersReducedMotion={prefersReducedMotion}
        />
      }
    >
      <Component />
    </Suspense>
  );
}

function getInitialTheme(): Theme {
  const stored = localStorage.getItem('theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function useHasHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => useAuthStore.persist.hasHydrated());
  useEffect(() => {
    const unsub = useAuthStore.persist.onFinishHydration(() => setHydrated(true));
    setHydrated(useAuthStore.persist.hasHydrated());
    return unsub;
  }, []);
  return hydrated;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.accessToken);
  const hasHydrated = useHasHydrated();
  const prefersReducedMotion = usePrefersReducedMotion();
  const desktopRuntime = isTauriRuntime();

  if (!hasHydrated) {
    return (
      <PageTransitionLoader
        variant="fullscreen"
        caption="准备工作台"
        title="正在载入页面"
        description="同步登录状态、主题设置和你的工作区布局。"
        prefersReducedMotion={prefersReducedMotion}
      />
    );
  }
  if (!token) {
    if (desktopRuntime) {
      return (
        <PageTransitionLoader
          variant="fullscreen"
          caption="连接桌面网关"
          title="正在建立桌面默认身份"
          description="桌面端不需要登录账号，正在使用已选择的 Gateway 进入工作台。"
          prefersReducedMotion={prefersReducedMotion}
        />
      );
    }

    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function DesktopGatewayRecovery({
  error,
  onReconfigure,
  onRetry,
}: {
  error: string;
  onReconfigure: () => void;
  onRetry: () => void;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9998,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
        padding: 24,
      }}
    >
      <section
        style={{
          width: 'min(440px, calc(100vw - 48px))',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          padding: 24,
          border: '1px solid var(--border)',
          borderRadius: 16,
          background: 'var(--surface)',
          boxShadow: '0 24px 80px oklch(0 0 0 / 0.34)',
        }}
      >
        <strong style={{ color: 'var(--text)', fontSize: 18 }}>无法建立桌面默认身份</strong>
        <p style={{ color: 'var(--text-3)', fontSize: 13, lineHeight: 1.6, margin: 0 }}>
          桌面端不需要账号登录，但需要先连接到可用 Gateway。请重试连接，或重新选择本地/远程网关。
        </p>
        <p style={{ color: 'var(--danger)', fontSize: 12, lineHeight: 1.5, margin: 0 }}>{error}</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={onRetry}
            style={{
              flex: 1,
              border: 'none',
              borderRadius: 10,
              padding: '0.75rem 0.9rem',
              background: 'var(--accent)',
              color: 'var(--accent-text)',
              cursor: 'pointer',
              fontWeight: 700,
            }}
          >
            重试连接
          </button>
          <button
            type="button"
            onClick={onReconfigure}
            style={{
              flex: 1,
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: '0.75rem 0.9rem',
              background: 'transparent',
              color: 'var(--text)',
              cursor: 'pointer',
              fontWeight: 700,
            }}
          >
            重新选择网关
          </button>
        </div>
      </section>
    </div>
  );
}

function useDesktopGatewayBootstrap(
  enabled: boolean,
  accessToken: string | null,
  retryKey: number,
  setBootstrapError: (message: string | null) => void,
) {
  useEffect(() => {
    if (!enabled || !isTauriRuntime()) {
      return;
    }

    let cancelled = false;

    async function bootstrap() {
      const mode = readDesktopGatewayMode();
      const { setAuth, setGatewayUrl, setWebAccess, webPort } = useAuthStore.getState();
      const port = webPort;
      const localUrl = localGatewayUrl(port);

      try {
        setBootstrapError(null);
        if (mode === 'local') {
          setGatewayUrl(localUrl);
          setWebAccess(true, port);
          await startDesktopGateway(port);
          if (!(await waitForGatewayHealth(localUrl))) {
            throw new Error('本地 Gateway 健康检查失败');
          }
        }

        if (!accessToken && !cancelled) {
          if (mode !== 'local') {
            throw new Error('远程 Gateway 需要重新输入管理员凭据');
          }

          const tokenPair = await authenticateDesktopGateway(localUrl);
          if (!cancelled) {
            setAuth(
              tokenPair.accessToken,
              DESKTOP_DEFAULT_EMAIL,
              tokenPair.refreshToken,
              tokenPair.expiresIn,
            );
          }
        }
      } catch (error: unknown) {
        setBootstrapError(error instanceof Error ? error.message : '桌面默认身份建立失败');
        console.warn('Failed to bootstrap desktop gateway session', error);
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [accessToken, enabled, retryKey, setBootstrapError]);
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const openFileRef = useRef<OpenFileFn | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();
  const authHydrated = useHasHydrated();
  const accessToken = useAuthStore((state) => state.accessToken);
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const desktopRuntime = isTauriRuntime();
  const [desktopBootstrapError, setDesktopBootstrapError] = useState<string | null>(null);
  const [desktopBootstrapRetry, setDesktopBootstrapRetry] = useState(0);
  const [showTelemetryConsent, setShowTelemetryConsent] = useState(
    () => localStorage.getItem('telemetry_consent_shown') !== '1',
  );
  const [showOnboarding, setShowOnboarding] = useState(
    () => localStorage.getItem('onboarded') !== '1',
  );

  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  useDesktopGatewayBootstrap(
    authHydrated && !showOnboarding,
    accessToken,
    desktopBootstrapRetry,
    setDesktopBootstrapError,
  );

  // C-9 系统主题跟随：监听 Rust 端 emit 的 'theme-changed'，自动切换 dark/light。
  useEffect(() => {
    if (!desktopRuntime) return;
    let unlistenFn: UnlistenFn | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const fn = await listenTauriEvent<string>('theme-changed', (event) => {
          const next = event.payload === 'dark' ? 'dark' : 'light';
          setTheme(next as 'dark' | 'light');
          localStorage.setItem('theme', next);
        });
        if (cancelled) fn();
        else unlistenFn = fn;
      } catch (_err) {
        // listen 失败不致命。
      }
    })();
    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, [desktopRuntime]);

  // 监听托盘菜单「显示配对二维码」点击事件（Rust 端 emit 'tray:show-pairing-qr'）。
  // 收到后跳转到设置、桌面端 tab，带 show=pairing 参数让 DesktopTabContent 自动展开 QR。
  const navigate = useNavigate();
  useEffect(() => {
    if (!desktopRuntime) return;
    let unlistenFn: UnlistenFn | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const fn = await listenTauriEvent<void>('tray:show-pairing-qr', () => {
          navigate('/settings/desktop?show=pairing');
        });
        if (cancelled) {
          fn();
        } else {
          unlistenFn = fn;
        }
      } catch (_err) {
        // listen 失败不致命，用户仍可手动导航进桌面端 tab。
      }
    })();
    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, [desktopRuntime, navigate]);

  // sidecar 崩溃自动重试：Rust 端 emit 'gateway:crashed' 后这里按 1s/3s/5s
  // 退避调用 start_gateway 重启 3 次。3 次失败则保留 Failed 健康状态供托盘显示。
  // 用户可在「设置 → 连接与模型」手动触发或在「设置 → 桌面端」查看状态。
  // 重启时按当前 store 中的 webExposeLan 决定 host，避免 LAN 共享设置在崩溃恢复后丢失。
  const desktopRuntimeWebPort = useAuthStore((s) => s.webPort);
  const desktopRuntimeWebExposeLan = useAuthStore((s) => s.webExposeLan);
  useEffect(() => {
    if (!desktopRuntime) return;
    let unlistenFn: UnlistenFn | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const fn = await listenTauriEvent<{ port: number }>('gateway:crashed', (event) => {
          const port = event.payload.port ?? desktopRuntimeWebPort;
          const host = desktopRuntimeWebExposeLan ? '0.0.0.0' : '127.0.0.1';
          // 退避重试：1s / 3s / 5s。
          void (async () => {
            for (const delay of [1000, 3000, 5000]) {
              await new Promise((r) => setTimeout(r, delay));
              try {
                await tauriInvoke('start_gateway', { port, host });
                return;
              } catch {
                // 失败继续下一轮。
              }
            }
            // 3 次都失败：保留 Failed，用户可通过「设置→连接与模型」手动操作。
          })();
        });
        if (cancelled) fn();
        else unlistenFn = fn;
      } catch (_err) {
        // listen 失败不致命。
      }
    })();
    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, [desktopRuntime, desktopRuntimeWebPort]);

  // 桌面端锁定状态。Rust 端在启动、隐藏到托盘、设/删除 PIN 时会 emit
  // 'lock-state-changed' 事件，payload = { locked, hasPin }。初始加载时主动查一次。
  const [desktopLocked, setDesktopLocked] = useState(false);
  const [idleLockMinutes, setIdleLockMinutes] = useState<number | null>(null);
  useEffect(() => {
    if (!desktopRuntime) return;
    let unlistenFn: UnlistenFn | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const initial = await tauriInvoke<{ locked: boolean; hasPin: boolean }>('get_lock_state');
        if (!cancelled) {
          setDesktopLocked(initial.locked && initial.hasPin);
        }
      } catch (_err) {
        // 获取失败默认不锁，避免卡死用户。
      }
      try {
        // 读一次 idle_lock_minutes，后续靠 lock-state-changed 事件或手动刷新即可。
        const settings = await tauriInvoke<{ idleLockMinutes: number | null }>(
          'get_desktop_settings',
        );
        if (!cancelled) {
          setIdleLockMinutes(settings.idleLockMinutes ?? null);
        }
      } catch (_err) {
        // 获取失败则不启用空闲锁。
      }
      try {
        const fn = await listenTauriEvent<{ locked: boolean; hasPin: boolean }>(
          'lock-state-changed',
          (event) => {
            setDesktopLocked(event.payload.locked && event.payload.hasPin);
          },
        );
        if (cancelled) fn();
        else unlistenFn = fn;
      } catch (_err) {
        // listen 失败不致命。
      }
    })();
    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, [desktopRuntime]);

  // 空闲自动锁：监听键鼠活动，超过 idleLockMinutes 分钟无操作调用 lock_desktop_now。
  // 锁定中 / 未设 PIN / 未配置空闲分钟时跳过。
  useEffect(() => {
    if (!desktopRuntime) return;
    if (desktopLocked) return;
    if (!idleLockMinutes || idleLockMinutes <= 0) return;
    const thresholdMs = idleLockMinutes * 60 * 1000;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleLock = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void tauriInvoke('lock_desktop_now').catch(() => undefined);
      }, thresholdMs);
    };
    const activityEvents = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];
    activityEvents.forEach((evt) => window.addEventListener(evt, scheduleLock, { passive: true }));
    scheduleLock();
    return () => {
      if (timer) clearTimeout(timer);
      activityEvents.forEach((evt) => window.removeEventListener(evt, scheduleLock));
    };
  }, [desktopRuntime, desktopLocked, idleLockMinutes]);

  function toggleTheme() {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }

  // 锁定时全屏遮罩，阻断主界面交互。解锁后 Rust 端会 emit
  // 'lock-state-changed'（locked=false），desktopLocked 随之变 false 自动隐藏 overlay。
  if (desktopLocked) {
    return <UnlockOverlay onUnlocked={() => setDesktopLocked(false)} />;
  }

  return (
    <>
      {showOnboarding && (
        <OnboardingModal
          onComplete={() => {
            localStorage.setItem('onboarded', '1');
            setShowOnboarding(false);
          }}
        />
      )}
      <TelemetryConsentModal
        open={showTelemetryConsent}
        onAccept={() => {
          localStorage.setItem('telemetry_consent_shown', '1');
          setShowTelemetryConsent(false);
        }}
        onDecline={() => {
          localStorage.setItem('telemetry_consent_shown', '1');
          setShowTelemetryConsent(false);
        }}
      />
      <ToastContainer />
      <UpdateBanner />
      {desktopRuntime &&
      authHydrated &&
      !showOnboarding &&
      !accessToken &&
      desktopBootstrapError ? (
        <DesktopGatewayRecovery
          error={desktopBootstrapError}
          onRetry={() => setDesktopBootstrapRetry((value) => value + 1)}
          onReconfigure={() => {
            clearAuth();
            localStorage.removeItem('onboarded');
            localStorage.removeItem(DESKTOP_GATEWAY_MODE_KEY);
            setDesktopBootstrapError(null);
            setShowOnboarding(true);
          }}
        />
      ) : null}
      <Routes>
        <Route
          path="/"
          element={
            desktopRuntime ? (
              <Navigate to="/chat" replace />
            ) : (
              <LoginPage theme={theme} onToggleTheme={toggleTheme} />
            )
          }
        />
        <Route
          element={
            <ProtectedRoute>
              <FileEditorContext.Provider value={openFileRef}>
                <Layout
                  theme={theme}
                  onToggleTheme={toggleTheme}
                  onOpenFile={(path) => openFileRef.current?.(path)}
                />
              </FileEditorContext.Provider>
            </ProtectedRoute>
          }
        >
          <Route
            path="/chat/:sessionId?"
            element={
              <LazyRoutePage
                component={PRELOADABLE_ROUTE_MODULES.chat.component}
                prefersReducedMotion={prefersReducedMotion}
                title={PRELOADABLE_ROUTE_MODULES.chat.title}
              />
            }
          />
          <Route
            path="/images/:sessionId?"
            element={
              <LazyRoutePage
                component={PRELOADABLE_ROUTE_MODULES.images.component}
                prefersReducedMotion={prefersReducedMotion}
                title={PRELOADABLE_ROUTE_MODULES.images.title}
              />
            }
          />
          <Route
            path="/sessions"
            element={
              <LazyRoutePage
                component={PRELOADABLE_ROUTE_MODULES.sessions.component}
                prefersReducedMotion={prefersReducedMotion}
                title={PRELOADABLE_ROUTE_MODULES.sessions.title}
              />
            }
          />
          <Route
            path="/artifacts"
            element={
              <LazyRoutePage
                component={PRELOADABLE_ROUTE_MODULES.artifacts.component}
                prefersReducedMotion={prefersReducedMotion}
                title={PRELOADABLE_ROUTE_MODULES.artifacts.title}
              />
            }
          />
          <Route
            path="/settings/:tab?"
            element={
              <LazyRoutePage
                component={PRELOADABLE_ROUTE_MODULES.settings.component}
                prefersReducedMotion={prefersReducedMotion}
                title={PRELOADABLE_ROUTE_MODULES.settings.title}
              />
            }
          />
          <Route
            path="/skills"
            element={
              <LazyRoutePage
                component={PRELOADABLE_ROUTE_MODULES.skills.component}
                prefersReducedMotion={prefersReducedMotion}
                title={PRELOADABLE_ROUTE_MODULES.skills.title}
              />
            }
          />
          <Route
            path="/skills/selection"
            element={
              <LazyRoutePage
                component={PRELOADABLE_ROUTE_MODULES.skillSelection.component}
                prefersReducedMotion={prefersReducedMotion}
                title={PRELOADABLE_ROUTE_MODULES.skillSelection.title}
              />
            }
          />
          <Route path="/channels" element={<Navigate to="/settings/channels" replace />} />
          <Route
            path="/workflows"
            element={
              <LazyRoutePage
                component={PRELOADABLE_ROUTE_MODULES.workflows.component}
                prefersReducedMotion={prefersReducedMotion}
                title={PRELOADABLE_ROUTE_MODULES.workflows.title}
              />
            }
          />
          <Route path="/prompt-optimizer" element={<Navigate to="/chat" replace />} />
          <Route path="/translation" element={<Navigate to="/chat" replace />} />
          <Route
            path="/team"
            element={
              <LazyRoutePage
                component={PRELOADABLE_ROUTE_MODULES.team.component}
                prefersReducedMotion={prefersReducedMotion}
                title={PRELOADABLE_ROUTE_MODULES.team.title}
              />
            }
          />
          <Route
            path="/team/:teamWorkspaceId"
            element={
              <LazyRoutePage
                component={PRELOADABLE_ROUTE_MODULES.team.component}
                prefersReducedMotion={prefersReducedMotion}
                title={PRELOADABLE_ROUTE_MODULES.team.title}
              />
            }
          />
          <Route
            path="/templates"
            element={
              <LazyRoutePage
                component={PRELOADABLE_ROUTE_MODULES.templates.component}
                prefersReducedMotion={prefersReducedMotion}
                title={PRELOADABLE_ROUTE_MODULES.templates.title}
              />
            }
          />
          <Route
            path="/agents"
            element={
              <LazyRoutePage
                component={PRELOADABLE_ROUTE_MODULES.agents.component}
                prefersReducedMotion={prefersReducedMotion}
                title={PRELOADABLE_ROUTE_MODULES.agents.title}
              />
            }
          />
          <Route
            path="/usage"
            element={
              <LazyRoutePage
                component={PRELOADABLE_ROUTE_MODULES.usage.component}
                prefersReducedMotion={prefersReducedMotion}
                title={PRELOADABLE_ROUTE_MODULES.usage.title}
              />
            }
          />
          <Route
            path="/schedules"
            element={
              <LazyRoutePage
                component={PRELOADABLE_ROUTE_MODULES.schedules.component}
                prefersReducedMotion={prefersReducedMotion}
                title={PRELOADABLE_ROUTE_MODULES.schedules.title}
              />
            }
          />
          <Route
            path="/about"
            element={
              <LazyRoutePage
                component={PRELOADABLE_ROUTE_MODULES.about.component}
                prefersReducedMotion={prefersReducedMotion}
                title={PRELOADABLE_ROUTE_MODULES.about.title}
              />
            }
          />
        </Route>
      </Routes>
    </>
  );
}
