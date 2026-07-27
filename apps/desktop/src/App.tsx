import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router';
import { listen } from '@tauri-apps/api/event';
import { useAuthStore } from '../../web/src/stores/auth/auth.js';
import {
  useDisplayPreferencesHydrated,
  useDisplayPreferencesStore,
  type ThemeStyle,
} from '../../web/src/stores/settings/display-preferences.js';
import {
  readThemeStyle as storageReadThemeStyle,
  readThemeMode as storageReadThemeMode,
} from '../../web/src/stores/settings/theme-storage.js';
import OnboardingWizard from './onboarding/OnboardingWizard.js';
import ArtifactsPage from '../../web/src/pages/artifacts/ArtifactsPage.js';
import ChatPage from '../../web/src/pages/chat-page/ChatPage.js';
import SessionsPage from '../../web/src/pages/sessions-page/SessionsPage.js';
import SettingsPage from '../../web/src/pages/settings/SettingsPage.js';
import Layout from './components/layout/Layout.js';
import {
  authenticateDesktopGateway,
  DESKTOP_DEFAULT_EMAIL,
  DESKTOP_GATEWAY_MODE_KEY,
  localGatewayUrl,
  readDesktopGatewayMode,
  waitForGatewayHealth,
} from './utils/gateway-mode.js';
import { startDesktopGateway } from './utils/tauri-gateway.js';

interface NotificationAction {
  type: 'open_session' | 'open_channel';
  targetId: string;
}

type Theme = 'dark' | 'light';

function getInitialTheme(): Theme {
  const mode = storageReadThemeMode();
  if (mode === 'light') return 'light';
  if (mode === 'dark') return 'dark';
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
  if (!hasHydrated) return null;
  if (!token) return null;
  return <>{children}</>;
}

function DesktopBootstrapScreen({
  error,
  onReconfigure,
  onRetry,
  onChangePort,
}: {
  error: string | null;
  onReconfigure: () => void;
  onRetry: () => void;
  onChangePort?: () => void;
}) {
  const isPortOccupied = error?.includes('端口') && error?.includes('占用');

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'hsl(var(--background))',
      }}
    >
      <section
        style={{
          width: 'min(460px, calc(100vw - 48px))',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          padding: 24,
          border: '1px solid hsl(var(--border-default))',
          borderRadius: 18,
          background: 'hsl(var(--card))',
          boxShadow: '0 24px 80px hsl(220 40% 2% / 0.42)',
        }}
      >
        <strong style={{ fontSize: 18, color: 'hsl(var(--foreground))' }}>
          {error ? '无法建立桌面默认身份' : '正在建立桌面默认身份'}
        </strong>
        <p
          style={{
            color: 'hsl(var(--muted-foreground))',
            fontSize: 13,
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          桌面端不需要账号登录，但需要连接到可用
          Gateway。若当前网关不可用，请重新选择本地或远程网关。
        </p>
        {error ? (
          <p style={{ color: 'hsl(var(--destructive))', fontSize: 12, lineHeight: 1.5, margin: 0 }}>
            {error}
          </p>
        ) : null}
        {isPortOccupied ? (
          <div
            style={{
              background: 'hsl(var(--muted))',
              borderRadius: 10,
              padding: '12px 14px',
              fontSize: 12,
              lineHeight: 1.6,
              color: 'hsl(var(--muted-foreground))',
            }}
          >
            <strong style={{ color: 'hsl(var(--foreground))' }}>端口被占用解决方案：</strong>
            <ul style={{ margin: '8px 0 0 16px', padding: 0 }}>
              <li>关闭占用端口的程序（如上一次未正常退出的 OpenAWork）</li>
              <li>重启电脑释放残留端口</li>
              <li>点击下方「更换端口」使用其他端口</li>
            </ul>
          </div>
        ) : null}
        {error ? (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={onRetry}
              style={{
                flex: 1,
                minWidth: 100,
                border: '1px solid hsl(var(--primary) / 0.35)',
                borderRadius: 10,
                padding: '0.75rem 0.9rem',
                background: 'hsl(var(--primary))',
                color: 'hsl(var(--primary-foreground))',
                cursor: 'pointer',
                fontWeight: 700,
              }}
            >
              重试连接
            </button>
            {isPortOccupied && onChangePort ? (
              <button
                type="button"
                onClick={onChangePort}
                style={{
                  flex: 1,
                  minWidth: 100,
                  border: '1px solid hsl(var(--primary) / 0.35)',
                  borderRadius: 10,
                  padding: '0.75rem 0.9rem',
                  background: 'hsl(var(--primary))',
                  color: 'hsl(var(--primary-foreground))',
                  cursor: 'pointer',
                  fontWeight: 700,
                }}
              >
                更换端口
              </button>
            ) : null}
            <button
              type="button"
              onClick={onReconfigure}
              style={{
                flex: 1,
                minWidth: 100,
                border: '1px solid hsl(var(--border-default))',
                borderRadius: 10,
                padding: '0.75rem 0.9rem',
                background: 'transparent',
                color: 'hsl(var(--foreground))',
                cursor: 'pointer',
                fontWeight: 700,
              }}
            >
              重新选择网关
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function NotificationListener() {
  const navigate = useNavigate();

  useEffect(() => {
    const unlisten = listen<NotificationAction>('notification-action', (event) => {
      const { type, targetId } = event.payload;
      if (type === 'open_session') {
        void navigate(`/chat/${targetId}`);
      } else if (type === 'open_channel') {
        void navigate(`/channels/${targetId}`);
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [navigate]);

  return null;
}

function useDesktopGatewayBootstrap(
  enabled: boolean,
  accessToken: string | null,
  retryKey: number,
  setBootstrapError: (message: string | null) => void,
) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;

    async function bootstrap() {
      const { setAuth, setGatewayUrl, setWebAccess, webPort, webExposeLan } =
        useAuthStore.getState();
      const port = webPort;
      const localUrl = localGatewayUrl(port);
      const bindMode = webExposeLan ? 'lan' : 'localhost';

      console.log('[bootstrap] 开始启动网关', { port, localUrl, bindMode });

      try {
        setBootstrapError(null);
        if (readDesktopGatewayMode() === 'local') {
          setGatewayUrl(localUrl);
          setWebAccess(true, port);

          console.log('[bootstrap] 正在启动网关...');
          await startDesktopGateway(port, bindMode);
          console.log('[bootstrap] 网关启动命令已发送，等待健康检查...');

          const healthy = await waitForGatewayHealth(localUrl);
          console.log('[bootstrap] 健康检查结果:', healthy);

          if (!healthy) {
            throw new Error(
              `本地 Gateway 启动失败（端口 ${port}）。\n\n` +
                '可能原因：\n' +
                '1. 端口被其他程序占用\n' +
                '2. 网关进程启动后立即崩溃\n' +
                '3. 防火墙阻止了连接\n\n' +
                '解决方案：\n' +
                '1. 检查端口是否被占用：netstat -ano | findstr :' +
                port +
                '\n' +
                '2. 重启电脑释放残留端口\n' +
                '3. 更换其他端口',
            );
          }
        }

        if (!accessToken && !cancelled) {
          if (readDesktopGatewayMode() !== 'local') {
            throw new Error('远程 Gateway 需要重新输入管理员凭据');
          }

          console.log('[bootstrap] 正在认证...');
          const tokenPair = await authenticateDesktopGateway(localUrl);
          console.log('[bootstrap] 认证成功');

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
        console.error('[bootstrap] 启动失败:', error);
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
  const [initialThemeStyle, setInitialThemeStyle] = useState<ThemeStyle>(getInitialThemeStyle);
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem('onboarded') === '1');
  const displayPreferencesHydrated = useDisplayPreferencesHydrated();
  const themeMode = useDisplayPreferencesStore((state) => state.themeMode);
  const storeThemeStyle = useDisplayPreferencesStore((state) => state.themeStyle);
  const themeStyle = displayPreferencesHydrated ? storeThemeStyle : initialThemeStyle;
  const accessToken = useAuthStore((state) => state.accessToken);
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapRetry, setBootstrapRetry] = useState(0);

  useEffect(() => {
    console.log('[App] 已挂载, BUILD_V2');
  }, []);

  useDesktopGatewayBootstrap(onboarded, accessToken, bootstrapRetry, setBootstrapError);

  // 登录成功后（accessToken 从 null 变为有值），强制从 localStorage 重新读取主题。
  useEffect(() => {
    if (!accessToken) return;
    const savedStyle = storageReadThemeStyle();
    const savedMode = storageReadThemeMode();
    console.log('[theme-auth] login detected, re-reading theme:', savedStyle, savedMode);

    const store = useDisplayPreferencesStore.getState();
    if (savedStyle !== store.themeStyle) {
      store.setThemeStyle(savedStyle);
    }
    if (savedMode !== store.themeMode) {
      store.setThemeMode(savedMode);
    }

    setInitialThemeStyle(savedStyle);
  }, [accessToken]);

  useEffect(() => {
    if (!displayPreferencesHydrated) return;
    if (themeMode === 'system') {
      const mql = window.matchMedia('(prefers-color-scheme: light)');
      const next: Theme = mql.matches ? 'light' : 'dark';
      setTheme(next);
      const handler = (event: MediaQueryListEvent) => {
        setTheme(event.matches ? 'light' : 'dark');
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
    root.style.colorScheme = theme;
    // 仅在 Zustand persist 水合完成后才写入独立 key
    if (displayPreferencesHydrated) {
      try {
        localStorage.setItem('theme-style', themeStyle);
        localStorage.setItem('theme-mode', themeMode === 'system' ? 'system' : theme);
        localStorage.setItem('theme', theme);
      } catch {
        // ignore
      }
    }
  }, [theme, themeStyle, displayPreferencesHydrated, themeMode]);

  if (!onboarded) {
    return (
      <>
        <Routes>
          <Route path="*" element={<OnboardingWizard onComplete={() => setOnboarded(true)} />} />
        </Routes>
      </>
    );
  }

  if (!accessToken) {
    return (
      <>
        <DesktopBootstrapScreen
          error={bootstrapError}
          onRetry={() => setBootstrapRetry((value) => value + 1)}
          onChangePort={() => {
            // 打开设置页面让用户修改端口
            clearAuth();
            localStorage.removeItem('onboarded');
            localStorage.removeItem(DESKTOP_GATEWAY_MODE_KEY);
            setBootstrapError(null);
            setOnboarded(false);
          }}
          onReconfigure={() => {
            clearAuth();
            localStorage.removeItem('onboarded');
            localStorage.removeItem(DESKTOP_GATEWAY_MODE_KEY);
            setBootstrapError(null);
            setOnboarded(false);
          }}
        />
      </>
    );
  }

  return (
    <>
      <NotificationListener />
      <Layout>
        <Routes>
          <Route path="/onboarding" element={<Navigate to="/sessions" replace />} />
          <Route
            path="/sessions"
            element={
              <ProtectedRoute>
                <SessionsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/chat/:sessionId"
            element={
              <ProtectedRoute>
                <ChatPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/artifacts"
            element={
              <ProtectedRoute>
                <ArtifactsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/:tab?"
            element={
              <ProtectedRoute>
                <SettingsPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/sessions" replace />} />
        </Routes>
      </Layout>
    </>
  );
}
