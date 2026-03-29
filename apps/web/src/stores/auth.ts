import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { refreshAccessToken as apiRefreshToken } from '@openAwork/web-client';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: number | null;
  email: string | null;
  gatewayUrl: string;
  webAccessEnabled: boolean;
  webPort: number;
  setAuth: (accessToken: string, email: string, refreshToken?: string, expiresIn?: string) => void;
  clearAuth: () => void;
  setGatewayUrl: (url: string) => void;
  setWebAccess: (enabled: boolean, port: number) => void;
  refreshAccessToken: () => Promise<void>;
}

function parseExpiresIn(expiresIn: string): number {
  const match = /^(\d+)(m|s|h)?$/.exec(expiresIn);
  if (!match) return 15 * 60 * 1000;
  const n = parseInt(match[1] ?? '15', 10);
  const unit = match[2] ?? 'm';
  if (unit === 's') return n * 1000;
  if (unit === 'h') return n * 3600 * 1000;
  return n * 60 * 1000;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      email: null,
      gatewayUrl: 'http://localhost:3000',
      webAccessEnabled: false,
      webPort: 3000,
      setAuth: (accessToken, email, refreshToken, expiresIn) => {
        const ms = expiresIn ? parseExpiresIn(expiresIn) : 15 * 60 * 1000;
        set({
          accessToken,
          email,
          refreshToken: refreshToken ?? null,
          tokenExpiresAt: Date.now() + ms,
        });
      },
      clearAuth: () =>
        set({ accessToken: null, email: null, refreshToken: null, tokenExpiresAt: null }),
      setGatewayUrl: (url) => set({ gatewayUrl: url }),
      setWebAccess: (enabled, port) => set({ webAccessEnabled: enabled, webPort: port }),
      refreshAccessToken: async () => {
        const { refreshToken, gatewayUrl } = get();
        if (!refreshToken) return;
        try {
          const data = await apiRefreshToken(gatewayUrl, refreshToken);
          const ms = parseExpiresIn(data.expiresIn ?? '15m');
          set({
            accessToken: data.accessToken,
            refreshToken: data.refreshToken,
            tokenExpiresAt: Date.now() + ms,
          });
        } catch {
          get().clearAuth();
        }
      },
    }),
    {
      name: 'auth-store',
      partialize: (s) => ({
        accessToken: s.accessToken,
        refreshToken: s.refreshToken,
        tokenExpiresAt: s.tokenExpiresAt,
        email: s.email,
        gatewayUrl: s.gatewayUrl,
        webAccessEnabled: s.webAccessEnabled,
        webPort: s.webPort,
      }),
      onRehydrateStorage: () => (_state, error) => {
        void error;
        void _state;
      },
    },
  ),
);

setInterval(() => {
  const state = useAuthStore.getState();
  if (!state.accessToken || !state.refreshToken || !state.tokenExpiresAt) return;
  if (state.tokenExpiresAt - Date.now() < 2 * 60 * 1000) {
    void state.refreshAccessToken();
  }
}, 60_000);
