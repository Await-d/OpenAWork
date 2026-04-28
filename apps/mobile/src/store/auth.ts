import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

const ACCESS_TOKEN_KEY = 'openwork_access_token';
const REFRESH_TOKEN_KEY = 'openwork_refresh_token';
const GATEWAY_URL_KEY = 'openwork_gateway_url';
const DEFAULT_GATEWAY_URL = 'http://localhost:3000';

function isLocalDevelopmentHostname(hostname: string): boolean {
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '10.0.2.2' ||
    hostname === '10.0.3.2'
  ) {
    return true;
  }

  if (/^10\./.test(hostname) || /^192\.168\./.test(hostname)) {
    return true;
  }

  const private172 = /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
  return private172 || hostname.endsWith('.local');
}

export function normalizeMobileGatewayUrl(rawUrl: string): string {
  const normalized = rawUrl.trim().replace(/\/$/, '');
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error('网关地址格式不正确，请输入完整的 http(s):// 地址。');
  }

  if (parsed.protocol === 'https:') {
    return normalized;
  }

  if (parsed.protocol === 'http:' && isLocalDevelopmentHostname(parsed.hostname)) {
    return normalized;
  }

  throw new Error('移动端仅允许 HTTPS 网关；本地开发时可使用 localhost 或局域网私网地址。');
}

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
  gatewayUrl: DEFAULT_GATEWAY_URL,
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
        gatewayUrl: gateway ? normalizeMobileGatewayUrl(gateway) : DEFAULT_GATEWAY_URL,
        isLoading: false,
      });
    } catch {
      set({ gatewayUrl: DEFAULT_GATEWAY_URL, isLoading: false });
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
