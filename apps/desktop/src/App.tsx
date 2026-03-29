import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router';
import { listen } from '@tauri-apps/api/event';
import { useAuthStore } from '../../web/src/stores/auth.js';
import OnboardingWizard from './onboarding/OnboardingWizard.js';
import ArtifactsPage from '../../web/src/pages/ArtifactsPage.js';
import ChatPage from '../../web/src/pages/ChatPage.js';
import SessionsPage from '../../web/src/pages/SessionsPage.js';
import SettingsPage from '../../web/src/pages/SettingsPage.js';
import Layout from './components/layout/Layout.js';

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
  if (!token) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
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

export default function App() {
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem('onboarded') === '1');

  if (!onboarded) {
    return (
      <Routes>
        <Route path="*" element={<OnboardingWizard onComplete={() => setOnboarded(true)} />} />
      </Routes>
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
    </>
  );
}
