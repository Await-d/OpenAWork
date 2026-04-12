import { Suspense, useState, useEffect, createContext, useContext, useRef } from 'react';
import type { ComponentType, LazyExoticComponent, MutableRefObject } from 'react';

export type OpenFileFn = (path: string) => void;
export const FileEditorContext = createContext<MutableRefObject<OpenFileFn | null>>({
  current: null,
} as MutableRefObject<OpenFileFn | null>);
export function useFileEditorContext() {
  return useContext(FileEditorContext);
}
import { Routes, Route, Navigate } from 'react-router';
import { useAuthStore } from './stores/auth.js';
import LoginPage from './pages/LoginPage.js';
import Layout from './components/Layout.js';
import OnboardingModal from './components/OnboardingModal.js';
import PageTransitionLoader from './components/PageTransitionLoader.js';
import { ToastContainer } from './components/ToastNotification.js';
import UpdateBanner from './components/UpdateBanner.js';
import { usePrefersReducedMotion } from './hooks/usePrefersReducedMotion.js';
import { PRELOADABLE_ROUTE_MODULES } from './routes/preloadable-route-modules.js';
import { TelemetryConsentModal } from '@openAwork/shared-ui';

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
  if (!token) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const openFileRef = useRef<OpenFileFn | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();
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

  function toggleTheme() {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
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
      <Routes>
        <Route path="/" element={<LoginPage theme={theme} onToggleTheme={toggleTheme} />} />
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
        </Route>
      </Routes>
    </>
  );
}
