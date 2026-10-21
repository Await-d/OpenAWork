import {
  Suspense,
  useState,
  useEffect,
  useLayoutEffect,
  createContext,
  useContext,
  useMemo,
  useRef,
} from 'react';
import type { ComponentType, LazyExoticComponent, MutableRefObject } from 'react';
import type { OpenFileOptions } from './hooks/editor/useFileEditor.js';

export type { OpenFileOptions };
export type OpenFileFn = (path: string, options?: OpenFileOptions) => void;

/**
 * FileEditor 桥接对象：**ref 与「可用性」刻意分成两个通道**。
 *
 * 消费方要在渲染期判断「当前能不能点开文件」，而渲染期读 `openRef.current`
 * 会被 React Compiler 判定为 "Cannot access refs during render" 并放弃优化
 * 整个组件（实测 path-display / markdown-path-ref / file-content-preview /
 * grep-content-hits-preview / modified-files-summary-card 五个组件都因此脱靶）。
 *
 * 所以 `isAvailable` 走 **state**：由注册方（ChatPage）在 effect 里发布，
 * 对渲染期合法，而且**可响应式**——顺带修掉了旧写法的隐患：ref 写入不触发
 * 重渲染，旧 `canOpen` 得等到下一次无关重渲染才会变 true。
 *
 * `openRef` 保留给事件处理器调用（引用稳定，不会引起额外重渲染）。
 */
export interface FileEditorBridge {
  readonly openRef: MutableRefObject<OpenFileFn | null>;
  readonly isAvailable: boolean;
  readonly setAvailable: (value: boolean) => void;
}

export const FileEditorContext = createContext<FileEditorBridge>({
  openRef: { current: null },
  isAvailable: false,
  setAvailable: () => undefined,
});
export function useFileEditorContext(): FileEditorBridge {
  return useContext(FileEditorContext);
}
import { Routes, Route, Navigate, useNavigate } from 'react-router';
import { UnlockOverlay } from './components/common/modal/UnlockOverlay.js';
import { CloseConfirmDialog } from './components/common/modal/CloseConfirmDialog.js';
import { AboutDialog } from './components/common/modal/AboutDialog.js';
import { tauriInvoke } from './pages/settings/shared/settings-page-helpers.js';
import { useAuthStore } from './stores/auth/auth.js';
import {
  useDisplayPreferencesHydrated,
  useDisplayPreferencesStore,
  type ThemeStyle,
} from './stores/settings/display-preferences.js';
import { useCurrentUserProfileBootstrap } from './stores/user-profile/current-user-profile.js';
import { useDisplayPreferencesSyncBootstrap } from './stores/settings/display-preferences-sync.js';
import { useWorkspaceStateSyncBootstrap } from './stores/ui/workspace-state-sync.js';
import {
  readThemeStyle as storageReadThemeStyle,
  readThemeMode as storageReadThemeMode,
  diagnoseThemeStorage,
} from './stores/settings/theme-storage.js';
import LoginPage from './pages/misc/LoginPage.js';
import NotFoundPage from './pages/misc/NotFoundPage.js';
import HomePage from './pages/home/HomePage.js';
import Layout from './components/Layout.js';
import OnboardingModal from './components/onboarding/OnboardingModal.js';
import PageTransitionLoader from './components/common/feedback/PageTransitionLoader.js';
import { ToastContainer } from './components/common/feedback/ToastNotification.js';
import UpdateBanner from './components/common/feedback/UpdateBanner.js';
import { usePrefersReducedMotion } from './hooks/ui/usePrefersReducedMotion.js';
import { PRELOADABLE_ROUTE_MODULES } from './routes/preloadable-route-modules.js';
import { IslandReporter } from './island/island-reporter.js';
import {
  DEFAULT_FILE_ICON_THEME,
  FileIconThemeProvider,
  isFileIconThemeId,
  loadMaterialIconManifest,
  TelemetryConsentModal,
} from '@openAwork/shared-ui';
import { useTelemetry } from './hooks/use-telemetry.js';
import { logger } from './utils/log/logger.js';
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
import { migrateDesktopWorkbenchLayout } from './stores/ui/desktop-workbench-layout-migration.js';
import { listenTauriEvent, type UnlistenFn } from './utils/tauri/tauri-events.js';

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
  const mode = storageReadThemeMode();
  if (mode === 'light') return 'light';
  if (mode === 'dark') return 'dark';
  // system → 跟随系统偏好
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function getInitialThemeStyle(): ThemeStyle {
  return storageReadThemeStyle();
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
        background: 'var(--bg-base)',
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
          border: '1px solid var(--border-default)',
          borderRadius: 16,
          background: 'var(--bg-overlay)',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <strong style={{ color: 'var(--fg-strong)', fontSize: 18 }}>无法建立桌面默认身份</strong>
        <p style={{ color: 'var(--fg-muted)', fontSize: 13, lineHeight: 1.6, margin: 0 }}>
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
              color: 'var(--fg-on-accent)',
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
              border: '1px solid var(--border-default)',
              borderRadius: 10,
              padding: '0.75rem 0.9rem',
              background: 'transparent',
              color: 'var(--fg-strong)',
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

/**
 * 桌面端本地网关的启动阶段：
 * - `idle`：尚未开始（认证状态还没水合，或首次引导弹窗仍开着）；
 * - `starting`：正在拉起 sidecar 并等待健康检查；
 * - `ready`：网关已就绪，可以安全渲染业务页面；
 * - `error`：启动失败，交由 `DesktopGatewayRecovery` 处理。
 */
type DesktopGatewayPhase = 'idle' | 'starting' | 'ready' | 'error';

function useDesktopGatewayBootstrap(
  enabled: boolean,
  accessToken: string | null,
  retryKey: number,
  setBootstrapError: (message: string | null) => void,
): DesktopGatewayPhase {
  const [phase, setPhase] = useState<DesktopGatewayPhase>('idle');

  useEffect(() => {
    if (!enabled || !isTauriRuntime()) {
      return;
    }

    let cancelled = false;

    async function bootstrap() {
      // accessToken 写入后会触发本 effect 重跑；已就绪时不回退到 starting，
      // 否则启动遮罩会重新闪出。
      setPhase((current) => (current === 'ready' ? current : 'starting'));

      // 所有可能抛错的语句（含 localStorage / store 读取）都放在 try 内：
      // 任何异常都必须落到 error 阶段，否则遮罩会永久停在 starting 无法撤除。
      // 整段下沉到模块级 `runBootstrapOnce`（见其注释）：try 内的 `throw` 与值块都会让
      // 编译器放弃优化整个组件。语义逐字照搬（含各 `return` 提前退出）。
      await runBootstrapOnce({
        onError: (error) => {
          if (!cancelled) {
            setBootstrapError(error instanceof Error ? error.message : '桌面默认身份建立失败');
            setPhase('error');
          }
          console.warn('Failed to bootstrap desktop gateway session', error);
        },
        run: async () => {
          setBootstrapError(null);

          const mode = readDesktopGatewayMode();
          const { setAuth, setGatewayUrl, setWebAccess, webPort, webExposeLan } =
            useAuthStore.getState();
          const port = webPort;
          const localUrl = localGatewayUrl(port);

          if (mode === 'local') {
            setGatewayUrl(localUrl);
            setWebAccess(true, port);
            // bind host 必须与用户选择一致：LAN 模式下若仍以 127.0.0.1 启动，
            // 原生侧幂等短路会因 host 变化而反复重启 sidecar 并静默关闭 LAN 共享。
            // startedAt 覆盖 start_gateway 的耗时:启动 + 等待共用同一份固定预算,
            // 否则两层各自计时会让启动遮罩的最长停留时间叠加成 2 倍。
            const startedAt = Date.now();
            await startDesktopGateway(port, webExposeLan ? 'lan' : 'localhost');
            if (!(await waitForGatewayHealth(localUrl, { startedAt }))) {
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

          if (!cancelled) {
            setPhase('ready');
          }
        },
      });
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [accessToken, enabled, retryKey, setBootstrapError]);

  return phase;
}

/**
 * sidecar 崩溃自动重启的退避阶梯与固定总预算。
 *
 * 崩溃重启是后台静默行为,不该长时间反复尝试:从 `gateway:crashed` 触发起
 * 固定 30s 封顶,期间最多 2 轮(2s / 5s 退避)。用尽后保留 Failed 状态,
 * 交由用户在设置页手动处理。
 */
const CRASH_RESTART_BACKOFF_MS = [2_000, 5_000];
const CRASH_RESTART_TOTAL_BUDGET_MS = 30_000;
/**
 * 单次 `start_gateway` 的预算下界,与 Rust 侧 `STARTUP_HEALTH_WAIT_TIMEOUT`(15s)
 * 对齐:`invoke` 不可中断,只有预算还够覆盖一次完整尝试时才值得再试。
 */
const CRASH_RESTART_ATTEMPT_BUDGET_MS = 15_000;

/**
 * 主题偏好持久化的收敛点：写独立 key 供首帧读取；localStorage 不可用时静默忽略。
 *
 * 必须留在模块级：try 内的三元值块会让编译器报
 * "Support value blocks ... within a try/catch statement" 并放弃优化整个组件（实测）。
 */
function persistThemePreferencesOnce(
  themeStyle: ThemeStyle,
  theme: Theme,
  themeMode: string,
): void {
  try {
    localStorage.setItem('theme-style', themeStyle);
    localStorage.setItem('theme-mode', themeMode === 'system' ? 'system' : theme);
    localStorage.setItem('theme', theme);
  } catch {
    // ignore
  }
}

/**
 * 桌面 sidecar 启动流程的统一包装：run 全流程留在 try 内，catch 交给 onError。
 *
 * 必须留在模块级：try 内的 `throw`（用于把健康检查失败落到 error 阶段）会被判为
 * "Support ThrowStatement inside of try/catch"，同样会让整个组件脱靶（实测）。
 */
/**
 * 读取桌面锁状态；失败时返回 null（按「不锁」处理，避免卡死用户）。
 *
 * 必须留在模块级：try 内的 `&&` 是值块，会让编译器报
 * "Support value blocks ... within a try/catch statement" 并放弃优化整个组件（实测）。
 */
async function readDesktopLockedOnce(): Promise<boolean | null> {
  try {
    const initial = await tauriInvoke<{ locked: boolean; hasPin: boolean }>('get_lock_state');
    return initial.locked && initial.hasPin;
  } catch (_err) {
    // 获取失败默认不锁，避免卡死用户。
    return null;
  }
}

/**
 * 读取空闲锁分钟数；失败时返回 undefined（不启用空闲锁）。
 *
 * 必须留在模块级：try 内的 `??` 是值块，会让编译器报
 * "Support value blocks ... within a try/catch statement" 并放弃优化整个组件（实测）。
 */
async function readIdleLockMinutesOnce(): Promise<number | null | undefined> {
  try {
    // 读一次 idle_lock_minutes，后续靠 lock-state-changed 事件或手动刷新即可。
    const settings = await tauriInvoke<{ idleLockMinutes: number | null }>('get_desktop_settings');
    return settings.idleLockMinutes ?? null;
  } catch (_err) {
    // 获取失败则不启用空闲锁。
    return undefined;
  }
}

async function runBootstrapOnce(ctx: {
  onError: (error: unknown) => void;
  run: () => Promise<void>;
}): Promise<void> {
  try {
    await ctx.run();
  } catch (error) {
    ctx.onError(error);
  }
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [initialThemeStyle, setInitialThemeStyle] = useState<ThemeStyle>(getInitialThemeStyle);
  const displayPreferencesHydrated = useDisplayPreferencesHydrated();
  const themeMode = useDisplayPreferencesStore((s) => s.themeMode);
  const setThemeMode = useDisplayPreferencesStore((s) => s.setThemeMode);
  const storeThemeStyle = useDisplayPreferencesStore((s) => s.themeStyle);
  const themeStyle = displayPreferencesHydrated ? storeThemeStyle : initialThemeStyle;
  const fileIconTheme = useDisplayPreferencesStore((s) => s.fileIconTheme);
  // localStorage 可能残留非主题 id 的脏值（历史数据/手改），交给类型守卫兜底。
  const effectiveFileIconTheme = isFileIconThemeId(fileIconTheme)
    ? fileIconTheme
    : DEFAULT_FILE_ICON_THEME;
  const openFileRef = useRef<OpenFileFn | null>(null);
  const [fileEditorAvailable, setFileEditorAvailable] = useState(false);
  /**
   * 这里必须手写 memo：本组件因为带有 react-hooks 的抑制注释而被 React Compiler
   * 排除（另有 6 处 "cannot access variable before declared"），拿不到自动
   * memoization。若不 memo 住 context value，App 的每次重渲染都会换一个新对象，
   * 导致整棵消费方子树跟着重渲染。
   *
   * 注意：注释里**不要**写出 eslint 抑制指令的原文——编译器按文本匹配来识别
   * 抑制注释，把原文写进注释会把本组件自己也排除掉。
   */
  const fileEditorBridge = useMemo<FileEditorBridge>(
    () => ({
      openRef: openFileRef,
      isAvailable: fileEditorAvailable,
      setAvailable: setFileEditorAvailable,
    }),
    [fileEditorAvailable, openFileRef],
  );
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
  const telemetry = useTelemetry();
  const [showOnboarding, setShowOnboarding] = useState(
    () => localStorage.getItem('onboarded') !== '1',
  );

  const desktopGatewayPhase = useDesktopGatewayBootstrap(
    authHydrated && !showOnboarding,
    accessToken,
    desktopBootstrapRetry,
    setDesktopBootstrapError,
  );

  // 桌面端必须先等本地网关就绪再渲染业务路由，否则页面会在 sidecar 启动完成前
  // 发出请求，表现为空数据与加载失败。Web 端 desktopRuntime 为 false，此遮罩
  // 不会出现，行为完全不变。
  const desktopGatewayBlocking =
    desktopRuntime && !showOnboarding && desktopGatewayPhase !== 'ready';
  const desktopGatewayReady = !desktopGatewayBlocking;

  useLayoutEffect(() => {
    migrateDesktopWorkbenchLayout({
      isDesktopRuntime: desktopRuntime,
      storage: typeof localStorage === 'undefined' ? undefined : localStorage,
    });
  }, [desktopRuntime]);

  useCurrentUserProfileBootstrap(authHydrated && desktopGatewayReady);
  useDisplayPreferencesSyncBootstrap(authHydrated && desktopGatewayReady);
  // 工作台现场（打开记录 + 面板布局）跨设备恢复：与显示偏好同一时机启动。
  useWorkspaceStateSyncBootstrap(authHydrated && desktopGatewayReady);

  useEffect(() => {
    if (effectiveFileIconTheme !== 'material') return;
    void loadMaterialIconManifest().catch((error: unknown) => {
      logger.warn('文件图标清单预热失败，图标将降级为通用轮廓', error);
    });
  }, [effectiveFileIconTheme]);

  // 登录成功后（accessToken 从 null 变为有值），强制从 localStorage 重新读取主题。
  // 这解决了：登录前显示默认主题，登录后没有切换到用户保存的主题的问题。
  useEffect(() => {
    if (!accessToken) return;
    const savedStyle = storageReadThemeStyle();
    const savedMode = storageReadThemeMode();
    console.log('[theme-auth] login detected, re-reading theme:', savedStyle, savedMode);
    diagnoseThemeStorage();

    // 如果读到的主题与当前 store 不同，更新 store
    const store = useDisplayPreferencesStore.getState();
    if (savedStyle !== store.themeStyle) {
      store.setThemeStyle(savedStyle);
    }
    if (savedMode !== store.themeMode) {
      store.setThemeMode(savedMode);
    }

    // 更新 initialThemeStyle 以防 displayPreferencesHydrated 仍为 false
    setInitialThemeStyle(savedStyle);
  }, [accessToken]);

  // 主题模式：system 跟随系统，light/dark 强制。
  useEffect(() => {
    if (!displayPreferencesHydrated) return;
    if (themeMode === 'system') {
      const mql = window.matchMedia('(prefers-color-scheme: light)');
      const next: Theme = mql.matches ? 'light' : 'dark';
      setTheme(next);
      const handler = (e: MediaQueryListEvent) => {
        setTheme(e.matches ? 'light' : 'dark');
      };
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    }
    setTheme(themeMode === 'light' ? 'light' : 'dark');
  }, [displayPreferencesHydrated, themeMode]);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', themeStyle);
    root.setAttribute('data-mode', theme);
    // 仅在 Zustand persist 水合完成后才写入独立 key，
    // 避免在水合前用默认值覆盖之前保存的真实偏好。
    if (displayPreferencesHydrated) {
      // 持久化（含 try/catch 与三元值块）下沉到模块级 `persistThemePreferencesOnce`。
      persistThemePreferencesOnce(themeStyle, theme, themeMode);
    }
  }, [theme, themeStyle, displayPreferencesHydrated, themeMode]);

  // C-9 系统主题跟随：监听 Rust 端 emit 的 'theme-changed'，自动切换 dark/light。
  useEffect(() => {
    if (!desktopRuntime || themeMode !== 'system') return;
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
  }, [desktopRuntime, themeMode]);

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

  // 监听托盘菜单「检查更新」（Rust 端 emit 'tray:check-updates'，payload = { autoStart }）。
  //
  // 桌面端历史上这个事件没有任何监听者，所以托盘点击是空操作。现在把它收敛到
  // 「设置 → 关于」——那里是唯一跑通完整更新流程（检查 / 下载 / 安装 / 重启）的页面。
  // autoStart 为真时带 check=1，AboutPage 进入后会自动发起一次桌面端检查。
  useEffect(() => {
    if (!desktopRuntime) return;
    let unlistenFn: UnlistenFn | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const fn = await listenTauriEvent<{ autoStart?: boolean }>(
          'tray:check-updates',
          (event) => {
            const autoStart = event.payload?.autoStart !== false;
            void navigate(autoStart ? '/settings/about?check=1' : '/settings/about');
          },
        );
        if (cancelled) {
          fn();
        } else {
          unlistenFn = fn;
        }
      } catch (_err) {
        // listen 失败不致命，用户仍可手动进入「设置 → 关于」检查更新。
      }
    })();
    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, [desktopRuntime, navigate]);

  // sidecar 崩溃自动重试：Rust 端 emit 'gateway:crashed' 后这里按 2s/5s 退避调用
  // start_gateway 最多重启 2 次,并共用同一份固定总预算(超预算或失败即保留 Failed 状态)。
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
          // 退避重试：2s / 5s,最多 2 轮,并受固定总预算封顶。Linux/AppImage 场景下 sidecar 需要解压
          // gzip payload，首次启动可能需要数秒，因此退避间隔适当加大。
          void (async () => {
            const deadline = Date.now() + CRASH_RESTART_TOTAL_BUDGET_MS;
            for (const backoffMs of CRASH_RESTART_BACKOFF_MS) {
              // `start_gateway` 在 Rust 侧最多等 15s 才返回且不可中断,预算不够覆盖
              // 一次完整尝试时直接放弃,否则实际耗时仍会突破封顶。
              if (deadline - Date.now() < CRASH_RESTART_ATTEMPT_BUDGET_MS) {
                break;
              }

              await new Promise((r) => setTimeout(r, Math.min(backoffMs, deadline - Date.now())));
              try {
                await tauriInvoke('start_gateway', { port, host });
                return;
              } catch {
                // 失败继续下一档退避。
              }
            }
            // 重试用尽或超预算：保留 Failed，用户可通过「设置→连接与模型」手动操作。
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
      // 读取（含 try/catch 与 `&&` 值块）下沉到模块级 `readDesktopLockedOnce`。
      const locked = await readDesktopLockedOnce();
      if (!cancelled && locked !== null) {
        setDesktopLocked(locked);
      }
      // 同上：读取（含 `??` 值块）下沉到模块级 `readIdleLockMinutesOnce`。
      const idleMinutes = await readIdleLockMinutesOnce();
      if (!cancelled && idleMinutes !== undefined) {
        setIdleLockMinutes(idleMinutes);
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
    setThemeMode(theme === 'dark' ? 'light' : 'dark');
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }

  // 监听 app:cycle-theme 自定义事件（由 ChatPage 快捷键 Ctrl+Alt+T 触发）
  useEffect(() => {
    const handler = () => toggleTheme();
    window.addEventListener('app:cycle-theme', handler);
    return () => window.removeEventListener('app:cycle-theme', handler);
    // 依赖刻意只含 theme / themeMode（toggleTheme 随二者派生）。不要在此处
    // 加回 lint 抑制指令——编译器按文本匹配识别它，会放弃优化整个 App。
  }, [theme, themeMode]);

  // 锁定时全屏遮罩，阻断主界面交互。解锁后 Rust 端会 emit
  // 'lock-state-changed'（locked=false），desktopLocked 随之变 false 自动隐藏 overlay。
  // 关闭确认弹窗必须一起渲染：锁定状态下点 X 同样需要给出应用内确认。
  if (desktopLocked) {
    return (
      <>
        <CloseConfirmDialog />
        <AboutDialog />
        <UnlockOverlay onUnlocked={() => setDesktopLocked(false)} />
      </>
    );
  }

  // 网关未就绪前只渲染启动遮罩 / 恢复界面，不挂载业务路由，避免 sidecar 启动
  // 期间页面发出请求导致空数据与加载失败。就绪后自动落入下方正常渲染。
  if (desktopGatewayBlocking) {
    return (
      <FileIconThemeProvider theme={effectiveFileIconTheme} mode={theme}>
        <CloseConfirmDialog />
        <AboutDialog />
        {desktopBootstrapError ? (
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
        ) : (
          <PageTransitionLoader
            variant="fullscreen"
            caption="启动本地网关"
            title="正在启动桌面网关"
            description="正在等待本地 Gateway 就绪，就绪后会自动进入工作台。"
            prefersReducedMotion={prefersReducedMotion}
          />
        )}
      </FileIconThemeProvider>
    );
  }

  return (
    <FileIconThemeProvider theme={effectiveFileIconTheme} mode={theme}>
      <CloseConfirmDialog />
      <AboutDialog />
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
          void telemetry.updateConsent('accepted');
          setShowTelemetryConsent(false);
        }}
        onDecline={() => {
          void telemetry.updateConsent('declined');
          setShowTelemetryConsent(false);
        }}
      />
      <ToastContainer />
      <UpdateBanner />
      <IslandReporter />
      <Routes>
        <Route
          path="/"
          element={
            desktopRuntime || accessToken ? (
              <Navigate to="/home" replace />
            ) : (
              <LoginPage theme={theme} onToggleTheme={toggleTheme} />
            )
          }
        />
        <Route
          element={
            <ProtectedRoute>
              <FileEditorContext value={fileEditorBridge}>
                <Layout
                  theme={theme}
                  onToggleTheme={toggleTheme}
                  onOpenFile={(path, options) => openFileRef.current?.(path, options)}
                />
              </FileEditorContext>
            </ProtectedRoute>
          }
        >
          <Route path="/home" element={<HomePage />} />
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
          <Route path="/about" element={<Navigate to="/settings/about" replace />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </FileIconThemeProvider>
  );
}
