import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { acquireRefresh } from '@openAwork/web-client';

/**
 * 根据当前浏览器地址动态计算默认 Gateway 地址。
 * - 浏览器端口为 5173（Vite 默认开发端口）时，Gateway 默认端口 3000；
 * - 浏览器端口非 5173 时（如生产部署或自定义端口），Gateway 默认端口与浏览器端口保持一致。
 * - 非 browser 环境（SSR / Tauri）回退到 http://localhost:3000。
 */
function getDefaultGatewayUrl(): string {
  if (typeof window === 'undefined' || !window.location) {
    return 'http://localhost:3000';
  }
  const { port, protocol } = window.location;
  const isViteDevPort = port === '5173';
  if (isViteDevPort) {
    return 'http://localhost:3000';
  }
  return `${protocol}//${window.location.hostname}:${port}`;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: number | null;
  email: string | null;
  gatewayUrl: string;
  webAccessEnabled: boolean;
  webPort: number;
  /**
   * 桌面端「Web 端访问」section 的局域网共享开关。
   * - false（默认）→ sidecar bind 127.0.0.1，仅本机可访问；
   * - true → sidecar bind 0.0.0.0，同局域网设备可通过本机 IP 访问。
   * 持久化到 localStorage，下次启动 Rust 端会按此值重新 spawn sidecar。
   */
  webExposeLan: boolean;
  /**
   * 自定义域名，用于生成分享链接等对外 URL。
   * 为空时分享链接功能不可用，需用户在设置中配置。
   */
  customBaseUrl: string;
  setAuth: (accessToken: string, email: string, refreshToken?: string, expiresIn?: string) => void;
  clearAuth: () => void;
  setGatewayUrl: (url: string) => void;
  setWebAccess: (enabled: boolean, port: number, exposeLan?: boolean) => void;
  setCustomBaseUrl: (url: string) => void;
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
      gatewayUrl: getDefaultGatewayUrl(),
      webAccessEnabled: false,
      webPort: 3000,
      webExposeLan: false,
      customBaseUrl: '',
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
      setWebAccess: (enabled, port, exposeLan) =>
        set((state) => ({
          webAccessEnabled: enabled,
          webPort: port,
          // 未显式传 exposeLan 时保留原值，避免「连接与模型」面板的 toggleWebAccess
          // 在仅切换启停时把「桌面端」面板配置的 LAN 开关意外重置。
          webExposeLan: exposeLan ?? state.webExposeLan,
        })),
      setCustomBaseUrl: (url) => set({ customBaseUrl: url.replace(/\/+$/, '') }),
      refreshAccessToken: async () => {
        const { refreshToken, gatewayUrl } = get();
        if (!refreshToken) return;
        // 通过 acquireRefresh 全局单飞入口刷新，与 withTokenRefresh 的被动刷新共享
        // 同一个 in-flight promise，避免并发使用同一个 refresh token 导致轮换竞态。
        const tokenStore = {
          getAccessToken: () => get().accessToken,
          getRefreshToken: () => get().refreshToken,
          setTokens: (accessToken: string, newRefreshToken: string, expiresIn: string) => {
            const ms = parseExpiresIn(expiresIn);
            set({
              accessToken,
              refreshToken: newRefreshToken,
              tokenExpiresAt: Date.now() + ms,
            });
          },
          clearAuth: () => get().clearAuth(),
        };
        await acquireRefresh(gatewayUrl, tokenStore);
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
        webExposeLan: s.webExposeLan,
        customBaseUrl: s.customBaseUrl,
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
