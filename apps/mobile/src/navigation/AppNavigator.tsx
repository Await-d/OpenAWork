import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useAuthStore } from '../store/auth';
import { SessionsScreen } from '../screens/SessionsScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

type Screen =
  | { name: 'loading' }
  | { name: 'onboarding' }
  | { name: 'sessions' }
  | { name: 'chat'; sessionId: string }
  | { name: 'settings' };

export function AppNavigator() {
  const { accessToken, loadFromStorage, logout } = useAuthStore();
  const [screen, setScreen] = useState<Screen>({ name: 'loading' });

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
      setScreen({ name: 'sessions' });
    }
  }, [accessToken, screen.name]);

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
