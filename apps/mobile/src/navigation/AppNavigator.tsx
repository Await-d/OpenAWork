import { useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '../store/auth';
import { SessionsScreen } from '../screens/SessionsScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

const TOKEN_EXPIRES_AT_KEY = 'openwork_token_expires_at';
const REFRESH_INTERVAL_MS = 60_000;
const REFRESH_THRESHOLD_MS = 2 * 60 * 1000;

function parseExpiresIn(expiresIn: string): number {
  const match = /^(\d+)(m|s|h)?$/.exec(expiresIn);
  if (!match) return 15 * 60 * 1000;
  const n = parseInt(match[1] ?? '15', 10);
  const unit = match[2] ?? 'm';
  if (unit === 's') return n * 1000;
  if (unit === 'h') return n * 3600 * 1000;
  return n * 60 * 1000;
}

type Screen =
  | { name: 'loading' }
  | { name: 'onboarding' }
  | { name: 'sessions' }
  | { name: 'chat'; sessionId: string }
  | { name: 'settings' };

export function AppNavigator() {
  const { accessToken, gatewayUrl, setTokens, loadFromStorage, logout } = useAuthStore();
  const [screen, setScreen] = useState<Screen>({ name: 'loading' });
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    void (async () => {
      await loadFromStorage();
      const onboarded = await AsyncStorage.getItem('onboarded');
      if (!onboarded) {
        setScreen({ name: 'onboarding' });
      } else {
        setScreen({ name: 'sessions' });
      }
    })();
  }, [loadFromStorage]);

  useEffect(() => {
    if (screen.name !== 'loading' && screen.name !== 'onboarding' && !accessToken) {
      setScreen({ name: 'onboarding' });
    }
  }, [accessToken, screen.name]);

  useEffect(() => {
    if (!accessToken || !gatewayUrl) return;

    async function tryRefresh() {
      try {
        const expiresAtStr = await SecureStore.getItemAsync(TOKEN_EXPIRES_AT_KEY);
        if (!expiresAtStr) return;
        const expiresAt = parseInt(expiresAtStr, 10);
        if (isNaN(expiresAt)) return;
        if (expiresAt - Date.now() > REFRESH_THRESHOLD_MS) return;

        const refreshToken = await SecureStore.getItemAsync('openwork_refresh_token');
        if (!refreshToken) return;

        const res = await fetch(`${gatewayUrl}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          accessToken: string;
          refreshToken: string;
          expiresIn?: string;
        };
        await setTokens(data.accessToken, data.refreshToken);
        const expiresInMs = data.expiresIn ? parseExpiresIn(data.expiresIn) : 15 * 60 * 1000;
        await SecureStore.setItemAsync(TOKEN_EXPIRES_AT_KEY, String(Date.now() + expiresInMs));
      } catch {
        void 0;
      }
    }

    refreshTimerRef.current = setInterval(() => {
      void tryRefresh();
    }, REFRESH_INTERVAL_MS);
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [accessToken, gatewayUrl, setTokens]);

  if (screen.name === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  if (screen.name === 'onboarding') {
    return null;
  }

  if (screen.name === 'chat') {
    return <ChatScreen sessionId={screen.sessionId} />;
  }

  if (screen.name === 'settings') {
    return (
      <SettingsScreen
        onLogout={async () => {
          await logout();
          setScreen({ name: 'sessions' });
        }}
      />
    );
  }

  return (
    <SessionsScreen
      onSelectSession={(sessionId) => setScreen({ name: 'chat', sessionId })}
      onNewSession={() => {}}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f172a' },
});
