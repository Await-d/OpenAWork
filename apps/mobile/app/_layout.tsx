import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuthStore } from '../src/store/auth';
import { NetworkBanner } from '../src/components/NetworkBanner';
import { initSentry } from '../src/monitoring/sentry';

const SENTRY_DSN = process.env['EXPO_PUBLIC_SENTRY_DSN'] ?? '';
if (SENTRY_DSN) initSentry(SENTRY_DSN);

export default function RootLayout() {
  const loadFromStorage = useAuthStore((s) => s.loadFromStorage);
  const router = useRouter();
  const [hasCheckedOnboarding, setHasCheckedOnboarding] = useState(false);

  useEffect(() => {
    void loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    let isMounted = true;

    async function checkOnboarding() {
      const onboarded = await AsyncStorage.getItem('onboarded');

      if (!isMounted) {
        return;
      }

      setHasCheckedOnboarding(true);
      if (!onboarded) {
        router.replace('/onboarding');
      }
    }

    void checkOnboarding();

    return () => {
      isMounted = false;
    };
  }, [router]);

  if (!hasCheckedOnboarding) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#0f172a',
          }}
        >
          <ActivityIndicator size="large" color="#6366f1" />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <NetworkBanner />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#0f172a' },
          headerTintColor: '#f8fafc',
          headerTitleStyle: { fontWeight: '600' },
          contentStyle: { backgroundColor: '#0f172a' },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ title: 'Sign In', headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ title: 'Onboarding', headerShown: false }} />
        <Stack.Screen name="sessions" options={{ title: 'Sessions' }} />
        <Stack.Screen name="chat/[sessionId]" options={{ title: 'Chat' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
