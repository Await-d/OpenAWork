/**
 * `usePageReadiness` — 内置浏览器的页面就绪探测。
 *
 * 解决的问题：agent 刚敲下 `npm run dev` 时，dev server 往往还要几秒才
 * 开始监听端口。此时内置浏览器已经按探测到的 URL 发起了加载，结果是一个
 * 白屏 / 连接被拒绝的错误页；等服务器真正起来后，用户还得手动点一次刷新。
 *
 * 这里对**本机与局域网地址**做主动探活：
 *   - `no-cors` fetch：只要能建立连接就算通（不关心 404 / CORS），
 *     这正是判断"服务是否在监听"所需要的语义；
 *   - 未通则按指数退避重试（600ms → 4s 封顶），次数用尽后落到 `unreachable`；
 *   - 首次就绪时回调 `onReady`，调用方据此决定是否需要重新加载页面。
 *
 * 只对私有 / 环回地址启探测：外部站点探活没有意义（跨域必然失败），
 * 还会产生一堆无用的网络请求。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { probeLocalServiceReachable } from '../../../../utils/net/local-service-probe.js';

export type PageReadinessState = 'idle' | 'probing' | 'ready' | 'unreachable';

export interface UsePageReadinessOptions {
  url: string;
  /** 关闭探测（例如 Tauri 原生 webview 模式，由宿主自己管理加载）。 */
  enabled?: boolean;
  /** 最多探测多少次，用尽后进入 `unreachable`。 */
  maxAttempts?: number;
  /** 首次重试间隔，之后按 2 的幂增长。 */
  baseDelayMs?: number;
  /** 重试间隔上限。 */
  maxDelayMs?: number;
  /** 单次探测的超时。 */
  requestTimeoutMs?: number;
  /** 首次探测到服务可达时触发一次（用于自动重新加载页面）。 */
  onReady?: () => void;
}

export interface UsePageReadinessResult {
  state: PageReadinessState;
  /** 当前 URL 是否在探测范围内（环回 / 私有网段）。 */
  monitored: boolean;
  /** 已发起的探测次数。 */
  attempt: number;
  /** 下一次重试的预计等待（毫秒），非等待状态为 null。 */
  nextRetryInMs: number | null;
  /** 手动重新开始一轮探测（用户点「重试」）。 */
  retry: () => void;
}

const DEFAULT_MAX_ATTEMPTS = 24;
const DEFAULT_BASE_DELAY_MS = 600;
const DEFAULT_MAX_DELAY_MS = 4_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 3_000;

/** 环回地址：localhost / *.localhost / 127.0.0.0/8 / ::1。 */
function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1' || host === '0.0.0.0') return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  return false;
}

/** RFC1918 / 链路本地网段——局域网真机预览（手机、平板）也会命中。 */
function isPrivateHost(hostname: string): boolean {
  const octets = hostname.split('.').map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((n) => Number.isNaN(n))) return false;
  const [a = -1, b = -1] = octets;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

/**
 * 该 URL 是否值得探测：必须是 http(s)，且指向环回或私有网段。
 * `about:blank`、`file:`、外部站点一律不探测。
 */
export function isProbeableUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return isLoopbackHost(parsed.hostname) || isPrivateHost(parsed.hostname);
  } catch {
    return false;
  }
}

export function usePageReadiness(options: UsePageReadinessOptions): UsePageReadinessResult {
  const {
    url,
    enabled = true,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    onReady,
  } = options;

  const monitored = enabled && isProbeableUrl(url);
  const [state, setState] = useState<PageReadinessState>('idle');
  const [attempt, setAttempt] = useState(0);
  const [nextRetryInMs, setNextRetryInMs] = useState<number | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  // onReady 只在"首次就绪"时触发一次，避免每轮重试成功都刷新页面。
  const readyNotifiedRef = useRef(false);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    readyNotifiedRef.current = false;
    if (!monitored) {
      setState('idle');
      setAttempt(0);
      setNextRetryInMs(null);
      return;
    }

    let disposed = false;
    let timer: number | null = null;
    let controller: AbortController | null = null;
    let currentAttempt = 0;

    setState('probing');
    setAttempt(0);
    setNextRetryInMs(null);

    const scheduleNext = (delayMs: number): void => {
      setNextRetryInMs(delayMs);
      timer = window.setTimeout(() => {
        timer = null;
        void probe();
      }, delayMs);
    };

    async function probe(): Promise<void> {
      if (disposed) return;
      currentAttempt += 1;
      setAttempt(currentAttempt);
      setNextRetryInMs(null);

      controller = new AbortController();
      const reachable = await probeLocalServiceReachable(url, {
        timeoutMs: requestTimeoutMs,
        signal: controller.signal,
      });
      if (disposed) return;

      if (reachable) {
        setState('ready');
        setNextRetryInMs(null);
        if (!readyNotifiedRef.current) {
          readyNotifiedRef.current = true;
          onReadyRef.current?.();
        }
        return;
      }

      if (currentAttempt >= maxAttempts) {
        setState('unreachable');
        setNextRetryInMs(null);
        return;
      }
      setState('probing');
      scheduleNext(Math.min(baseDelayMs * 2 ** (currentAttempt - 1), maxDelayMs));
    }

    void probe();

    return () => {
      disposed = true;
      if (timer !== null) window.clearTimeout(timer);
      controller?.abort();
    };
  }, [url, monitored, maxAttempts, baseDelayMs, maxDelayMs, requestTimeoutMs, retryNonce]);

  const retry = useCallback(() => {
    setRetryNonce((prev) => prev + 1);
  }, []);

  return { state, monitored, attempt, nextRetryInMs, retry };
}
