import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
  normalizeMobileGatewayUrl,
  resolveDefaultMobileGatewayUrl as resolveDefaultMobileGatewayUrlForPlatform,
  type MobileRuntimePlatform,
} from './mobile-gateway-defaults.js';

export { normalizeMobileGatewayUrl };

const ACCESS_TOKEN_KEY = 'openwork_access_token';
const REFRESH_TOKEN_KEY = 'openwork_refresh_token';
const GATEWAY_URL_KEY = 'openwork_gateway_url';

function currentMobileRuntimePlatform(): MobileRuntimePlatform {
  return Platform.OS === 'android' ? 'android' : 'ios';
}

export function resolveDefaultMobileGatewayUrl(
  platform: MobileRuntimePlatform = currentMobileRuntimePlatform(),
  configuredGatewayUrl: string | undefined = process.env['EXPO_PUBLIC_GATEWAY_URL'],
): string {
  return resolveDefaultMobileGatewayUrlForPlatform(platform, configuredGatewayUrl);
}

export const DEFAULT_MOBILE_GATEWAY_URL = resolveDefaultMobileGatewayUrl(
  currentMobileRuntimePlatform(),
  process.env['EXPO_PUBLIC_GATEWAY_URL'],
);

export interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  gatewayUrl: string;
  isLoading: boolean;
  setTokens: (access: string, refresh: string) => Promise<void>;
  setGatewayUrl: (url: string) => Promise<void>;
  loadFromStorage: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  refreshToken: null,
  gatewayUrl: DEFAULT_MOBILE_GATEWAY_URL,
  isLoading: true,

  setTokens: async (access, refresh) => {
    await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, access);
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refresh);
    set({ accessToken: access, refreshToken: refresh });
  },

  setGatewayUrl: async (url) => {
    const normalized = normalizeMobileGatewayUrl(url);
    await SecureStore.setItemAsync(GATEWAY_URL_KEY, normalized);
    set({ gatewayUrl: normalized });
  },

  loadFromStorage: async () => {
    try {
      const [access, refresh, gateway] = await Promise.all([
        SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
        SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
        SecureStore.getItemAsync(GATEWAY_URL_KEY),
      ]);
      set({
        accessToken: access,
        refreshToken: refresh,
        gatewayUrl: gateway ? normalizeMobileGatewayUrl(gateway) : DEFAULT_MOBILE_GATEWAY_URL,
        isLoading: false,
      });
    } catch {
      set({ gatewayUrl: DEFAULT_MOBILE_GATEWAY_URL, isLoading: false });
    }
  },

  logout: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    ]);
    set({ accessToken: null, refreshToken: null });
  },
}));
