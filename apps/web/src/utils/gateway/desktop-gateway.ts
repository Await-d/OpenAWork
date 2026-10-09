import { isGatewayHealthy as gatewayHealthCheck, type TokenPair } from '@openAwork/web-client';

export type DesktopGatewayMode = 'local' | 'remote';

export const DESKTOP_GATEWAY_MODE_KEY = 'desktop_gateway_mode';
export const DEFAULT_GATEWAY_PORT = 3000;
export const DESKTOP_DEFAULT_EMAIL = 'admin@openAwork.local';
/**
 * 就绪等待的**固定总超时**。
 *
 * 旧实现是「次数 × 间隔」(本地 120 × 500ms ≈ 60s),单次探测自身的耗时不计入预算,
 * 用户实际看到的等待时长因此会随探测快慢漂移。现在改为按 deadline 计时:
 * 从 `startedAt` 起算固定上限,探测快慢不影响总时长。
 */
const LOCAL_GATEWAY_READY_TIMEOUT_MS = 15_000;
const REMOTE_GATEWAY_READY_TIMEOUT_MS = 30_000;
const GATEWAY_HEALTH_CHECK_INTERVAL_MS = 500;

export interface WaitForGatewayHealthOptions {
  /** 固定总超时(毫秒);默认本地 15s / 远程 30s。 */
  timeoutMs?: number;
  /**
   * 计入超时预算的起点(毫秒时间戳),默认为进入函数时。
   *
   * 调用方若先执行了耗时的 `start_gateway`,应传入其开始时间,让「启动 + 等待」
   * 共用同一份预算,否则两层各自计时会让总时长叠加成 2 倍。
   */
  startedAt?: number;
}

interface TauriRuntime {
  isTauri?: boolean;
  __TAURI__?: {
    core: {
      invoke: <T>(name: string, args?: Record<string, unknown>) => Promise<T>;
    };
  };
  __TAURI_INTERNALS__?: {
    invoke: <T>(name: string, args?: Record<string, unknown>) => Promise<T>;
  };
}

export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const runtime = window as Window & TauriRuntime;
  return Boolean(runtime.__TAURI__ || runtime.__TAURI_INTERNALS__ || runtime.isTauri);
}

export function normalizeGatewayUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function localGatewayUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export function parseGatewayPort(value: string, fallback: number = DEFAULT_GATEWAY_PORT): number {
  const port = Number.parseInt(value, 10);
  return Number.isFinite(port) && port > 0 && port < 65536 ? port : fallback;
}

export function readGatewayPortFromUrl(
  gatewayUrl: string,
  fallback: number = DEFAULT_GATEWAY_PORT,
): number {
  try {
    const parsed = new URL(gatewayUrl);
    return parseGatewayPort(parsed.port || fallback.toString(), fallback);
  } catch (_error) {
    return fallback;
  }
}

export function isLocalGatewayUrl(gatewayUrl: string): boolean {
  try {
    const parsed = new URL(gatewayUrl);
    return (
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === 'localhost' ||
      parsed.hostname === '::1'
    );
  } catch (_error) {
    return false;
  }
}

export function desktopGatewayModeForUrl(gatewayUrl: string): DesktopGatewayMode {
  return isLocalGatewayUrl(gatewayUrl) ? 'local' : 'remote';
}

export async function isGatewayHealthy(gatewayUrl: string): Promise<boolean> {
  try {
    const url = normalizeGatewayUrl(gatewayUrl);
    if (isTauriRuntime() && isLocalGatewayUrl(url)) {
      return await invokeTauri<boolean>('check_local_gateway_health', {
        port: readGatewayPortFromUrl(url),
      });
    }

    return await gatewayHealthCheck(url, { timeoutMs: 2500 });
  } catch (_error) {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    // 用 `globalThis` 而非 `window`:jsdom 等测试环境不一定在 `window` 上挂定时器。
    globalThis.setTimeout(resolve, ms);
  });
}

export async function waitForGatewayHealth(
  gatewayUrl: string,
  options: WaitForGatewayHealthOptions = {},
): Promise<boolean> {
  const url = normalizeGatewayUrl(gatewayUrl);
  const isLocal = isTauriRuntime() && isLocalGatewayUrl(url);
  const timeoutMs =
    options.timeoutMs ??
    (isLocal ? LOCAL_GATEWAY_READY_TIMEOUT_MS : REMOTE_GATEWAY_READY_TIMEOUT_MS);
  const deadline = (options.startedAt ?? Date.now()) + timeoutMs;

  // 先探测再退避:网关常常已经就绪,第一时间就能通过,不必白等一个间隔。
  // 注意单次探测自身也可能耗时(本地 Tauri 侧 2s 上限),因此每轮结束后都重新
  // 校准剩余预算,而不是累加固定间隔。
  for (;;) {
    if (Date.now() >= deadline) {
      return false;
    }

    if (await isGatewayHealthy(url)) {
      return true;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return false;
    }

    await delay(Math.min(GATEWAY_HEALTH_CHECK_INTERVAL_MS, remaining));
  }
}

export function readDesktopGatewayMode(): DesktopGatewayMode | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }

  const value = localStorage.getItem(DESKTOP_GATEWAY_MODE_KEY);
  return value === 'local' || value === 'remote' ? value : null;
}

export function writeDesktopGatewayMode(mode: DesktopGatewayMode): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(DESKTOP_GATEWAY_MODE_KEY, mode);
}

async function invokeTauri<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const runtime = window as Window & TauriRuntime;
  if (runtime.__TAURI__) {
    return await runtime.__TAURI__.core.invoke<T>(name, args);
  }

  if (runtime.__TAURI_INTERNALS__) {
    return await runtime.__TAURI_INTERNALS__.invoke<T>(name, args);
  }

  if (runtime.isTauri) {
    throw new Error('Tauri IPC 尚未就绪。');
  }

  {
    throw new Error('当前不在 Tauri 桌面环境中运行。');
  }
}

/**
 * 桌面端 sidecar bind 模式：
 * - `localhost`：sidecar bind 127.0.0.1，仅本机可访问（默认）；
 * - `lan`：sidecar bind 0.0.0.0，同局域网设备可通过本机 IP 访问。
 */
export type DesktopGatewayBindMode = 'localhost' | 'lan';

export function gatewayBindHost(mode: DesktopGatewayBindMode): '127.0.0.1' | '0.0.0.0' {
  return mode === 'lan' ? '0.0.0.0' : '127.0.0.1';
}

export async function startDesktopGateway(
  port: number,
  mode: DesktopGatewayBindMode = 'localhost',
): Promise<void> {
  await invokeTauri<void>('start_gateway', { port, host: gatewayBindHost(mode) });
}

export async function stopDesktopGateway(): Promise<void> {
  await invokeTauri<void>('stop_gateway');
}

export async function pickDesktopFolder(): Promise<string | null> {
  return await invokeTauri<string | null>('pick_folder');
}

/**
 * 列出本机所有可在局域网中分发给其他设备的 IPv4 地址（RFC1918 私有段）。
 *
 * 仅在 Tauri 环境可用；在 Web/移动端调用会被 invokeTauri 抛错。
 * Rust 端实现见 `apps/desktop/src-tauri/src/lib.rs::list_lan_addresses`。
 */
export async function listLanAddresses(): Promise<string[]> {
  return await invokeTauri<string[]>('list_lan_addresses');
}

export async function authenticateDesktopGateway(gatewayUrl: string): Promise<TokenPair> {
  const url = normalizeGatewayUrl(gatewayUrl);
  if (!url) {
    throw new Error('请先选择网关地址。');
  }

  if (!isLocalGatewayUrl(url)) {
    throw new Error('桌面默认身份仅适用于本地网关。');
  }

  const runtime = window as Window & TauriRuntime;

  if (runtime.__TAURI__) {
    return await runtime.__TAURI__.core.invoke<TokenPair>('authenticate_desktop_gateway');
  }

  if (runtime.__TAURI_INTERNALS__) {
    return await runtime.__TAURI_INTERNALS__.invoke<TokenPair>('authenticate_desktop_gateway');
  }

  if (runtime.isTauri) {
    throw new Error('Tauri IPC 尚未就绪。');
  }

  throw new Error('当前不在 Tauri 桌面环境中运行。');
}
