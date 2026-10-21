import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { acquireRefresh } from '@openAwork/web-client';

/**
 * 根据当前运行形态动态计算默认 Gateway 地址。
 * - 开发态(Vite dev server)一律回落到 http://localhost:3000,与 vite.config.ts 中
 *   dev proxy 的 target 保持一致(端口漂移或端口转发域名下,同源推断会把默认地址
 *   解析成前端页面自身,详见 isAppSelfOriginUrl);
 * - 生产构建下 Gateway 与浏览器同源(网关自己托管前端);
 * - 非 browser 环境(SSR)回退到 http://localhost:3000。
 *
 * 使用 `window.location.host`(端口为默认值时自动省略端口)而非
 * `${hostname}:${port}` 拼接:HTTPS 默认端口(443)下 `port` 为空字符串,
 * 旧写法会产出 `https://example.com:` 这类尾随冒号的脆弱地址。
 */
function getDefaultGatewayUrl(): string {
  // 开发态(Vite dev server)一律用本机 3000,与 vite.config.ts 的 proxy target 对齐:
  // 页面由 dev server 托管时,任何同源推断都指向前端自身,请求会被 SPA 兜底成 index.html。
  if (import.meta.env.DEV) {
    return 'http://localhost:3000';
  }
  if (typeof window === 'undefined' || !window.location) {
    return 'http://localhost:3000';
  }
  const { protocol, host } = window.location;
  return `${protocol}//${host}`;
}

/** 去掉首尾空白与尾部斜杠。 */
function normalizeGatewayUrlInput(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
}

/**
 * 判断一个已持久化的网关地址是否就是「页面自身来源」——旧版 `getDefaultGatewayUrl`
 * 在端口非 5173 时的同源推断产物(端口漂移到 5180 之类),会被原样写进 localStorage。
 *
 * 开发态页面由 dev server 托管、网关固定在本机 3000,而 dev proxy 只转发
 * `/api`、`/auth`、`/sessions`,因此「网关地址 == 页面来源」必然让 `/usage`、
 * `/dev-logs`、`/settings` 这类请求落到 SPA 兜底上并拿回 `index.html`。仅在开发态
 * 做这个判定:生产构建下网关自己托管前端,同源本来就是合法的网关地址。
 */
function isAppSelfOriginUrl(value: string): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined' || !window.location) {
    return false;
  }
  return value === window.location.origin;
}

/**
 * 写入入口的归一化:空白值一律回落到默认地址。
 *
 * 空字符串会把所有 `${baseUrl}/xxx` 退化成相对路径,请求打到前端自身并被 SPA 兜底成
 * `index.html`(用量 / 开发日志 / Worker 等面板全部报 `Unexpected token '<'`),而
 * `/auth`、`/sessions` 因命中 dev proxy 仍能正常工作,极容易被误判成「后端接口坏了」。
 * 因此空地址绝不允许进入 store。
 */
function resolveGatewayUrl(value: string | null | undefined): string {
  const normalized = normalizeGatewayUrlInput(value);
  return normalized.length > 0 ? normalized : getDefaultGatewayUrl();
}

/**
 * rehydrate 入口的归一化:在写入归一化的基础上,额外修复旧版同源推断留下的脏值。
 *
 * 只在 rehydrate 阶段做这层修复,而不放进 `setGatewayUrl`:用户在设置面板里显式填写的
 * 地址应当被尊重(即便填得不对,也应看到可执行的错误提示,而不是被静默改写)。
 */
function healPersistedGatewayUrl(value: string | null | undefined): string {
  const normalized = normalizeGatewayUrlInput(value);
  if (normalized.length === 0 || isAppSelfOriginUrl(normalized)) {
    return getDefaultGatewayUrl();
  }
  return normalized;
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
      setGatewayUrl: (url) => set({ gatewayUrl: resolveGatewayUrl(url) }),
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
        try {
          await acquireRefresh(gatewayUrl, tokenStore);
        } catch (error) {
          // 瞬态刷新失败（网络 / 墙钟超时 / 5xx）：acquireRefresh 会保留登录态并抛出，
          // 这里必须吞掉——定时器里的 `void` 调用否则会变成 unhandled rejection。
          // 下一次到期检查或任意 401 会自然重试；凭证被服务端拒绝（401/403）时
          // acquireRefresh 已代为 clearAuth 并返回 null。
          console.warn('[auth] 令牌刷新失败（保留登录态，等待下次重试）', error);
        }
      },
    }),
    {
      name: 'auth-store',
      // 历史版本会往 localStorage 里写两类脏网关地址:空值(用户在登录页 / 连接面板
      // 清空输入框后未填回即离开),以及旧版同源推断把 dev server 端口(如 5180)当成
      // 网关地址。两者都会让 http 客户端把请求打到前端自身并被 SPA 兜底成 index.html,
      // 因此在 rehydrate 阶段就地修复(见 healPersistedGatewayUrl)。
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<AuthState>;
        return {
          ...currentState,
          ...persisted,
          gatewayUrl: healPersistedGatewayUrl(persisted.gatewayUrl ?? currentState.gatewayUrl),
        };
      },
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
