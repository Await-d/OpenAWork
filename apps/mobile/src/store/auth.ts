import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
  normalizeMobileGatewayUrl,
  resolveDefaultMobileGatewayUrl as resolveDefaultMobileGatewayUrlForPlatform,
  type MobileRuntimePlatform,
} from './mobile-gateway-defaults';

export { normalizeMobileGatewayUrl };

const ACCESS_TOKEN_KEY = 'openwork_access_token';
const REFRESH_TOKEN_KEY = 'openwork_refresh_token';
const GATEWAY_URL_KEY = 'openwork_gateway_url';
const CUSTOM_BASE_URL_KEY = 'openwork_custom_base_url';
const USER_EMAIL_KEY = 'openwork_user_email';

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
  customBaseUrl: string;
  userEmail: string;
  isLoading: boolean;
  setTokens: (access: string, refresh: string) => Promise<void>;
  setUserEmail: (email: string) => Promise<void>;
  setGatewayUrl: (url: string) => Promise<void>;
  setCustomBaseUrl: (url: string) => Promise<void>;
  loadFromStorage: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  refreshToken: null,
  gatewayUrl: DEFAULT_MOBILE_GATEWAY_URL,
  customBaseUrl: '',
  userEmail: '',
  isLoading: true,

  setTokens: async (access, refresh) => {
    await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, access);
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refresh);
    set({ accessToken: access, refreshToken: refresh });
  },

  setUserEmail: async (email) => {
    await SecureStore.setItemAsync(USER_EMAIL_KEY, email);
    set({ userEmail: email });
  },

  setGatewayUrl: async (url) => {
    const normalized = normalizeMobileGatewayUrl(url);
    await SecureStore.setItemAsync(GATEWAY_URL_KEY, normalized);
    set({ gatewayUrl: normalized });
  },

  setCustomBaseUrl: async (url) => {
    const normalized = url.replace(/\/+$/, '');
    await SecureStore.setItemAsync(CUSTOM_BASE_URL_KEY, normalized);
    set({ customBaseUrl: normalized });
  },

  loadFromStorage: async () => {
    try {
      const [access, refresh, gateway, baseUrl, email] = await Promise.all([
        SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
        SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
        SecureStore.getItemAsync(GATEWAY_URL_KEY),
        SecureStore.getItemAsync(CUSTOM_BASE_URL_KEY),
        SecureStore.getItemAsync(USER_EMAIL_KEY),
      ]);
      set({
        accessToken: access,
        refreshToken: refresh,
        gatewayUrl: gateway ? normalizeMobileGatewayUrl(gateway) : DEFAULT_MOBILE_GATEWAY_URL,
        customBaseUrl: baseUrl ?? '',
        userEmail: email ?? '',
        isLoading: false,
      });
    } catch {
      set({
        gatewayUrl: DEFAULT_MOBILE_GATEWAY_URL,
        customBaseUrl: '',
        userEmail: '',
        isLoading: false,
      });
    }
  },

  logout: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
      SecureStore.deleteItemAsync(USER_EMAIL_KEY),
    ]);
    set({ accessToken: null, refreshToken: null, userEmail: '' });
  },
}));
