import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

const ACCESS_TOKEN_KEY = 'openwork_access_token';
const REFRESH_TOKEN_KEY = 'openwork_refresh_token';
const GATEWAY_URL_KEY = 'openwork_gateway_url';

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
  gatewayUrl: 'http://localhost:3000',
  isLoading: true,

  setTokens: async (access, refresh) => {
    await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, access);
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refresh);
    set({ accessToken: access, refreshToken: refresh });
  },

  setGatewayUrl: async (url) => {
    await SecureStore.setItemAsync(GATEWAY_URL_KEY, url);
    set({ gatewayUrl: url });
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
        gatewayUrl: gateway ?? 'http://localhost:3000',
        isLoading: false,
      });
    } catch {
      set({ isLoading: false });
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
