import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack, useRouter, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuthStore } from '../src/store/auth';
import { subscribeAuthError } from '../src/hooks/use-auth-error-handler';
import { NetworkBanner } from '../src/components/NetworkBanner';
import { initSentry } from '../src/monitoring/sentry';
import { BottomNav, type BottomNavTab } from '../src/components/BottomNav';
import { shouldShowBottomNav } from '../src/layout/metrics';
import { colors } from '../src/theme/colors';

const SENTRY_DSN = process.env['EXPO_PUBLIC_SENTRY_DSN'] ?? '';
if (SENTRY_DSN) initSentry(SENTRY_DSN);

function resolveActiveTab(pathname: string): BottomNavTab {
  if (pathname === '/home' || pathname.startsWith('/home/')) return 'home';
  if (pathname === '/settings' || pathname.startsWith('/settings/')) return 'settings';
  // Chat detail is not a bottom-tab root; keep sessions as the nearest list tab.
  if (pathname.startsWith('/sessions') || pathname.startsWith('/chat')) return 'sessions';
  return 'home';
}

export default function RootLayout() {
  const loadFromStorage = useAuthStore((s) => s.loadFromStorage);
  const accessToken = useAuthStore((s) => s.accessToken);
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

  // 全局认证守卫：当 accessToken 被清除（如 API 返回 401 后 logout）时，
  // 自动重定向到登录页。排除已在公共路由（登录/连接/onboarding）上的情况。
  useEffect(() => {
    if (!hasCheckedOnboarding) return;
    if (accessToken) return;

    const publicRoutes = ['/login', '/connection', '/onboarding'];
    const isOnPublicRoute = publicRoutes.some(
      (route) => pathname === route || pathname.startsWith(route + '/'),
    );
    if (isOnPublicRoute) return;

    router.replace('/login');
  }, [accessToken, hasCheckedOnboarding, pathname, router]);

  // 全局 401 事件监听：当任意 API 调用返回 401 时（即使 catch 块没有
  // 显式调用 handleAuthError，只要 emitAuthError 被触发），
  // 立即重定向到登录页。这是 accessToken 守卫的补充——
  // emitAuthError 会同时触发 logout()（清除 token）和此事件，
  // 二者都能独立触发跳转，确保不会遗漏。
  useEffect(() => {
    if (!hasCheckedOnboarding) return;
    return subscribeAuthError(() => {
      const publicRoutes = ['/login', '/connection', '/onboarding'];
      const isOnPublicRoute = publicRoutes.some(
        (route) => pathname === route || pathname.startsWith(route + '/'),
      );
      if (!isOnPublicRoute) {
        router.replace('/login');
      }
    });
  }, [hasCheckedOnboarding, pathname, router]);

  const showNav = shouldShowBottomNav(pathname);

  const handleNav = (tab: BottomNavTab) => {
    if (tab === 'home') router.replace('/home');
    else if (tab === 'sessions') router.replace('/sessions');
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
        <Stack.Screen name="home" />
        <Stack.Screen name="chat/[sessionId]" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="settings/mcp" />
        <Stack.Screen name="settings/[section]" />
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
