import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router';
import { listen } from '@tauri-apps/api/event';
import { useAuthStore } from '../../web/src/stores/auth.js';
import OnboardingWizard from './onboarding/OnboardingWizard.js';
import ArtifactsPage from '../../web/src/pages/artifacts/ArtifactsPage.js';
import ChatPage from '../../web/src/pages/chat-page/ChatPage.js';
import SessionsPage from '../../web/src/pages/sessions-page/SessionsPage.js';
import SettingsPage from '../../web/src/pages/settings/SettingsPage.js';
import Layout from './components/layout/Layout.js';
import { UpdateProgressDialog } from './updater/UpdateProgressDialog.js';
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
}: {
  error: string | null;
  onReconfigure: () => void;
  onRetry: () => void;
}) {
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
          border: '1px solid hsl(var(--border))',
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
        {error ? (
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              onClick={onRetry}
              style={{
                flex: 1,
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
            <button
              type="button"
              onClick={onReconfigure}
              style={{
                flex: 1,
                border: '1px solid hsl(var(--border))',
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

      try {
        setBootstrapError(null);
        if (readDesktopGatewayMode() === 'local') {
          setGatewayUrl(localUrl);
          setWebAccess(true, port);
          await startDesktopGateway(port, bindMode);
          if (!(await waitForGatewayHealth(localUrl))) {
            throw new Error('本地 Gateway 健康检查失败');
          }
        }

        if (!accessToken && !cancelled) {
          if (readDesktopGatewayMode() !== 'local') {
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
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem('onboarded') === '1');
  const accessToken = useAuthStore((state) => state.accessToken);
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapRetry, setBootstrapRetry] = useState(0);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);

  useDesktopGatewayBootstrap(onboarded, accessToken, bootstrapRetry, setBootstrapError);

  useEffect(() => {
    const unlisten = listen('tray:check-updates', () => {
      setShowUpdateDialog(true);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  const updateDialog = showUpdateDialog ? (
    <UpdateProgressDialog autoCheck onClose={() => setShowUpdateDialog(false)} />
  ) : null;

  if (!onboarded) {
    return (
      <>
        <Routes>
          <Route path="*" element={<OnboardingWizard onComplete={() => setOnboarded(true)} />} />
        </Routes>
        {updateDialog}
      </>
    );
  }

  if (!accessToken) {
    return (
      <>
        <DesktopBootstrapScreen
          error={bootstrapError}
          onRetry={() => setBootstrapRetry((value) => value + 1)}
          onReconfigure={() => {
            clearAuth();
            localStorage.removeItem('onboarded');
            localStorage.removeItem(DESKTOP_GATEWAY_MODE_KEY);
            setBootstrapError(null);
            setOnboarded(false);
          }}
        />
        {updateDialog}
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
            path="/settings"
            element={
              <ProtectedRoute>
                <SettingsPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/sessions" replace />} />
        </Routes>
      </Layout>
      {updateDialog}
    </>
  );
}
