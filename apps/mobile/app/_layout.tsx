import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack, useRouter, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuthStore } from '../src/store/auth';
import { NetworkBanner } from '../src/components/NetworkBanner';
import { initSentry } from '../src/monitoring/sentry';
import { BottomNav, type BottomNavTab } from '../src/components/BottomNav';
import { colors } from '../src/theme/colors';

const SENTRY_DSN = process.env['EXPO_PUBLIC_SENTRY_DSN'] ?? '';
if (SENTRY_DSN) initSentry(SENTRY_DSN);

/** Screens that show the bottom navigation bar. */
const NAV_SCREENS: ReadonlySet<string> = new Set(['/sessions', '/chat', '/settings']);

function resolveActiveTab(pathname: string): BottomNavTab {
  if (pathname.startsWith('/settings')) return 'settings';
  if (pathname.startsWith('/chat')) return 'chat';
  return 'sessions';
}

export default function RootLayout() {
  const loadFromStorage = useAuthStore((s) => s.loadFromStorage);
  const router = useRouter();
  const pathname = usePathname();
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
        router.replace('/connection');
      }
    }

    void checkOnboarding();

    return () => {
      isMounted = false;
    };
  }, [router]);

  const showNav = NAV_SCREENS.has(pathname) || pathname.startsWith('/chat/');

  const handleNav = (tab: BottomNavTab) => {
    if (tab === 'sessions') router.replace('/sessions');
    else if (tab === 'chat') router.replace('/sessions');
    else if (tab === 'settings') router.replace('/settings');
  };

  if (!hasCheckedOnboarding) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.bgBase,
          }}
        >
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <NetworkBanner />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bgBase },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="connection" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="onboarding/gateway" />
        <Stack.Screen name="onboarding/client" />
        <Stack.Screen name="sessions" />
        <Stack.Screen name="sessions/new" />
        <Stack.Screen name="chat/[sessionId]" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="settings/mcp" />
        <Stack.Screen name="image-workspace" />
        <Stack.Screen name="network" />
        <Stack.Screen name="quick-commands" />
        <Stack.Screen name="artifacts" />
        <Stack.Screen name="change-review" />
        <Stack.Screen name="answer-retry" />
        <Stack.Screen name="panel-center" />
        <Stack.Screen name="snapshot-recovery" />
        <Stack.Screen name="input-context" />
        <Stack.Screen name="channels" />
        <Stack.Screen name="channel/[channelId]" />
        <Stack.Screen name="channel/diagnostics" />
        <Stack.Screen name="attachments" />
        <Stack.Screen name="agent-tasks" />
        <Stack.Screen name="image-params" />
        <Stack.Screen name="image-progress" />
      </Stack>
      {showNav && <BottomNav active={resolveActiveTab(pathname)} onNavigate={handleNav} />}
    </SafeAreaProvider>
  );
}
