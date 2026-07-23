import { check, type Update } from '@tauri-apps/plugin-updater';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { updaterJsonEndpointsForChannel, type UpdateChannel } from '@openAwork/shared';
import {
  clearProxyCache,
  detectFastestProxy,
  GITHUB_PROXIES,
  LEGACY_PROXY_PREFIXES,
  proxyUrl,
  type GitHubProxy,
} from './github-proxy.js';

export type { UpdateChannel } from './github-proxy.js';

export interface DownloadProgress {
  downloaded: number;
  total: number | null;
  percent: number;
}

export interface UpdateCheckResult {
  available: boolean;
  update: Update | null;
  version: string | null;
  notes: string | null;
  installMode: 'native' | 'proxy-auto' | 'manual';
  /** The update channel that was checked */
  channel: UpdateChannel;
  /** Non-null when the result was obtained through a proxy */
  proxyUsed: GitHubProxy | null;
  /** Proxied download URL (available when proxyUsed is set and update is available) */
  proxiedDownloadUrl?: string;
}

export type UpdateErrorKind =
  'network' | 'signature' | 'permission' | 'no_update' | 'cancelled' | 'unknown';

export class UpdateError extends Error {
  constructor(
    public readonly kind: UpdateErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'UpdateError';
  }
}

export function toUpdateError(err: unknown): UpdateError {
  if (err instanceof UpdateError) {
    return err;
  }
  const name = err instanceof Error ? err.name : '';
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  // Explicit user cancel (not AbortError stall timeouts from download watchdog).
  if (lower.includes('更新已取消') || lower.includes('cancelled by user')) {
    return new UpdateError('cancelled', msg);
  }
  if (
    name === 'AbortError' ||
    lower.includes('network') ||
    lower.includes('fetch') ||
    lower.includes('connect') ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('etimedout') ||
    lower.includes('econnrefused') ||
    lower.includes('econnreset') ||
    lower.includes('enotfound') ||
    lower.includes('dns') ||
    lower.includes('tls') ||
    lower.includes('ssl') ||
    lower.includes('certificate') ||
    lower.includes('unreachable') ||
    lower.includes('proxy') ||
    lower.includes('下载') ||
    lower.includes('网络')
  ) {
    return new UpdateError('network', msg);
  }
  if (lower.includes('signature') || lower.includes('verify') || lower.includes('签名')) {
    return new UpdateError('signature', msg);
  }
  if (lower.includes('permission') || lower.includes('access') || lower.includes('权限')) {
    return new UpdateError('permission', msg);
  }
  return new UpdateError('unknown', msg);
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/**
 * Detect the current build's update channel.
 * Tries the Rust command first; falls back to 'preview' as the default
 * (currently the only channel with published releases).
 */
export async function detectChannel(): Promise<UpdateChannel> {
  try {
    const channel = await invoke<string>('current_update_channel');
    if (channel === 'stable' || channel === 'preview') {
      return channel;
    }
  } catch {
    // Command not available or returned unexpected value
  }
  // Default: preview — the only channel with releases as of 2026-07
  return 'preview';
}

/**
 * Return the upstream endpoints for the given channel.
 *
 * Only use `latest.json` (direct GitHub asset URLs). Do NOT use `latest-cn.json`
 * here: its platform URLs are already proxy-prefixed by CI, and this path always
 * rewrites URLs through the live fastest proxy — combining the two would create
 * double-proxied download links that fail.
 */
function endpointsForChannel(channel: UpdateChannel): string[] {
  // includeCn for proxy fallback path only; native check uses tauri.conf endpoints.
  return updaterJsonEndpointsForChannel(channel, { includeCn: true });
}

/** Parse a dotted version into numeric segments for comparison. */
function parseVersionParts(version: string): number[] {
  return version
    .trim()
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .map((part) => {
      const match = part.match(/^\d+/);
      return match ? Number.parseInt(match[0], 10) : 0;
    });
}

/** Return true when `candidate` is strictly newer than `current`. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const left = parseVersionParts(candidate);
  const right = parseVersionParts(current);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    const a = left[i] ?? 0;
    const b = right[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

/**
 * If `url` already goes through a known proxy prefix, return it as-is.
 * Otherwise prefix it with the selected live proxy.
 *
 * Historical prefixes (ghp.ci / moeyy) that may still appear in published
 * latest-cn.json assets are stripped and re-proxied through the live proxy.
 */
export function ensureProxiedDownloadUrl(url: string, proxy: GitHubProxy): string {
  const knownPrefixes = GITHUB_PROXIES.map((item) => item.prefix);
  if (knownPrefixes.some((prefix) => url.startsWith(prefix))) {
    return url;
  }
  if (LEGACY_PROXY_PREFIXES.some((prefix) => url.startsWith(prefix))) {
    const stripped = LEGACY_PROXY_PREFIXES.reduce(
      (value, prefix) => (value.startsWith(prefix) ? value.slice(prefix.length) : value),
      url,
    );
    return proxyUrl(stripped, proxy);
  }
  return proxyUrl(url, proxy);
}

// --- Tauri updater JSON format ---
interface TauriUpdaterPlatform {
  signature: string;
  url: string;
}

interface TauriUpdaterJson {
  version: string;
  notes?: string;
  pub_date?: string;
  platforms: Record<string, TauriUpdaterPlatform>;
}

/**
 * Detect current platform key for Tauri updater JSON.
 *
 * Prefer the Rust-side compile-time key. The UA fallback is best-effort only:
 * browsers rarely expose host arch accurately, and Windows ARM often reports
 * as x64 under emulation.
 */
async function getCurrentPlatformKey(): Promise<string> {
  try {
    const platformKey = await invoke<string>('current_updater_platform');
    if (platformKey.trim().length > 0) {
      return platformKey;
    }
  } catch {
    // Fall through to UA heuristics.
  }

  const userAgent = navigator.userAgent.toLowerCase();
  const platform = (navigator.platform || '').toLowerCase();
  const archHint = `${userAgent} ${platform}`;

  if (userAgent.includes('windows') || platform.startsWith('win')) {
    return /aarch64|arm64/.test(archHint) ? 'windows-aarch64' : 'windows-x86_64';
  }
  if (
    userAgent.includes('mac os x') ||
    userAgent.includes('macintosh') ||
    platform.startsWith('mac')
  ) {
    // Apple Silicon browsers may still report Intel in some WebView modes;
    // prefer explicit arm markers when present.
    return /arm|aarch64/.test(archHint) ? 'darwin-aarch64' : 'darwin-x86_64';
  }
  if (/aarch64|arm64/.test(archHint)) return 'linux-aarch64';
  if (/armv7|armhf|arm/.test(archHint)) return 'linux-armv7';
  return 'linux-x86_64';
}

/**
 * Fetch latest.json through a proxy and parse it.
 */
async function fetchUpdaterJsonViaProxy(
  proxy: GitHubProxy,
  channel: UpdateChannel,
): Promise<{ json: TauriUpdaterJson; platformEntry: TauriUpdaterPlatform } | null> {
  const platformKey = await getCurrentPlatformKey();
  for (const endpoint of endpointsForChannel(channel)) {
    const url = proxyUrl(endpoint, proxy);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
      clearTimeout(timer);
      if (!res.ok) continue;
      const json: TauriUpdaterJson = await res.json();
      if (!json.version || !json.platforms) continue;
      const platformEntry = json.platforms[platformKey];
      if (!platformEntry?.url) continue;
      return { json, platformEntry };
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Primary check: uses Tauri's built-in check() which tries
 * all configured endpoints (including proxy ones).
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const channel = await detectChannel();

  // First, try Tauri's native check (endpoints include proxies in tauri.conf.json)
  try {
    const update = await check();
    if (!update) {
      return {
        available: false,
        update: null,
        version: null,
        notes: null,
        installMode: 'native',
        channel,
        proxyUsed: null,
      };
    }
    return {
      available: true,
      update,
      version: update.version,
      notes: update.body ?? null,
      installMode: 'native',
      channel,
      proxyUsed: null,
    };
  } catch (nativeErr) {
    const classified = toUpdateError(nativeErr);
    // Only fall back to proxy for network errors
    if (classified.kind !== 'network') {
      throw classified;
    }
  }

  // Fallback: probe proxies and fetch latest.json manually
  const proxy = await detectFastestProxy(channel);
  if (!proxy) {
    throw new UpdateError('network', '无法连接到 GitHub 或任何加速镜像，请检查网络连接后重试。');
  }

  const result = await fetchUpdaterJsonViaProxy(proxy, channel);
  if (!result) {
    // The cached winner may have gone stale between probe and GET.
    clearProxyCache();
    throw new UpdateError(
      'network',
      `通过代理 ${proxy.name} 获取更新信息失败，请重试以切换其他镜像。`,
    );
  }

  const { json, platformEntry } = result;

  // Native check() already compares versions; the proxy path must do it itself.
  // Without this, an already-up-to-date client would still report available=true
  // and offer a reinstall of the same version.
  let currentVersion = '';
  try {
    currentVersion = await getVersion();
  } catch {
    // If the app version cannot be read, fall through and treat remote as available.
  }
  if (currentVersion && !isNewerVersion(json.version, currentVersion)) {
    return {
      available: false,
      update: null,
      version: json.version,
      notes: json.notes ?? null,
      installMode: 'proxy-auto',
      channel,
      proxyUsed: proxy,
    };
  }

  const proxiedUrl = ensureProxiedDownloadUrl(platformEntry.url, proxy);

  return {
    available: true,
    update: null, // No native Update object — will use proxy download path
    version: json.version,
    notes: json.notes ?? null,
    installMode: 'proxy-auto',
    channel,
    proxyUsed: proxy,
    proxiedDownloadUrl: proxiedUrl,
  };
}

export interface DownloadUpdateOptions {
  /** When aborted, closes the native Update resource and rejects with kind=cancelled. */
  signal?: AbortSignal;
}

/**
 * Download using Tauri's native Update.download() — used when check()
 * succeeded via the native path.
 *
 * Pass `signal` so the UI can cancel: we call `update.close()` on abort, which
 * releases the underlying download stream (unlike a UI-only cancelledRef).
 */
export async function downloadUpdate(
  update: Update,
  onProgress: (progress: DownloadProgress) => void,
  options: DownloadUpdateOptions = {},
): Promise<void> {
  const signal = options.signal;
  if (signal?.aborted) {
    throw new UpdateError('cancelled', '更新已取消');
  }

  const abortNative = () => {
    void update.close().catch(() => undefined);
  };
  signal?.addEventListener('abort', abortNative, { once: true });

  try {
    let downloaded = 0;
    let total: number | null = null;

    await update.download((event) => {
      if (signal?.aborted) return;
      if (event.event === 'Started') {
        total = event.data.contentLength ?? null;
      } else if (event.event === 'Progress') {
        downloaded += event.data.chunkLength;
        onProgress({
          downloaded,
          total,
          percent: total ? clampPercent(Math.round((downloaded / total) * 100)) : 0,
        });
      }
    });
    if (signal?.aborted) {
      throw new UpdateError('cancelled', '更新已取消');
    }
  } catch (err) {
    if (signal?.aborted) {
      throw new UpdateError('cancelled', '更新已取消');
    }
    const classified = toUpdateError(err);
    // On download network failure, try proxy fallback
    if (classified.kind === 'network') {
      throw new UpdateError('network', '下载失败，网络不可达。请尝试使用代理更新。');
    }
    throw classified;
  } finally {
    signal?.removeEventListener('abort', abortNative);
  }
}

/**
 * Inter-chunk stall deadline for a proxied download. A download is legitimately
 * long-running, so a fixed total timeout would be wrong; instead we bound the
 * gap BETWEEN progress events. `downloadUpdateViaProxy` previously did a bare
 * `fetch` + `reader.read()` loop with no deadline at all (unlike every other
 * call in this module / `github-proxy`, which all use an AbortController). A
 * proxy that accepts the connection but never sends headers, or stalls
 * mid-stream, would leave the await pending forever — the updater progress bar
 * freezes with no error and no recovery. We abort the fetch (which rejects the
 * in-flight `reader.read()`) when no bytes arrive within this window.
 */
const DOWNLOAD_STALL_TIMEOUT_MS = 60_000;

/**
 * Download update file through a proxy (used when native download is unavailable).
 * Returns the downloaded bytes as an ArrayBuffer.
 */
export async function downloadUpdateViaProxy(
  downloadUrl: string,
  onProgress: (progress: DownloadProgress) => void,
  stallTimeoutMs: number = DOWNLOAD_STALL_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  // Stall watchdog + user cancel share one AbortController so in-flight
  // fetch/read rejects promptly instead of leaving the progress bar frozen.
  const controller = new AbortController();
  let stalled = false;
  let userCancelled = false;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  const armStallTimer = () => {
    if (stallTimeoutMs <= 0) return;
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      stalled = true;
      controller.abort();
    }, stallTimeoutMs);
  };
  const onUserAbort = () => {
    userCancelled = true;
    controller.abort();
  };
  if (signal?.aborted) {
    throw new UpdateError('cancelled', '更新已取消');
  }
  signal?.addEventListener('abort', onUserAbort, { once: true });

  try {
    armStallTimer();
    const res = await fetch(downloadUrl, { redirect: 'follow', signal: controller.signal });
    if (!res.ok) {
      throw new UpdateError('network', `代理下载失败: HTTP ${res.status}`);
    }

    const contentLength = res.headers.get('content-length');
    const total = contentLength ? parseInt(contentLength, 10) : null;
    const reader = res.body?.getReader();
    if (!reader) {
      throw new UpdateError('network', '无法读取下载流');
    }

    const chunks: Uint8Array[] = [];
    let downloaded = 0;

    while (true) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (err) {
        if (userCancelled || signal?.aborted) {
          throw new UpdateError('cancelled', '更新已取消');
        }
        if (stalled) {
          throw new UpdateError('network', `下载停滞超过 ${stallTimeoutMs}ms，网络可能已中断。`);
        }
        throw err;
      }
      if (result.done) break;
      const value = result.value;
      if (!value) continue;
      chunks.push(value);
      downloaded += value.byteLength;
      // Progress arrived → reset the stall deadline.
      armStallTimer();
      onProgress({
        downloaded,
        total,
        percent: total ? clampPercent(Math.round((downloaded / total) * 100)) : 0,
      });
    }

    // Merge chunks into a single ArrayBuffer
    const merged = new Uint8Array(downloaded);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged.buffer;
  } catch (err) {
    if (userCancelled || signal?.aborted) {
      throw new UpdateError('cancelled', '更新已取消');
    }
    if (stalled) {
      throw new UpdateError('network', `下载停滞超过 ${stallTimeoutMs}ms，网络可能已中断。`);
    }
    throw err;
  } finally {
    signal?.removeEventListener('abort', onUserAbort);
    if (stallTimer) clearTimeout(stallTimer);
  }
}

export interface InstallUpdateOptions {
  beforeInstall?: () => void | Promise<void>;
}

export async function installUpdate(
  update: Update,
  options: InstallUpdateOptions = {},
): Promise<void> {
  try {
    await options.beforeInstall?.();
    await update.install();
  } catch (err) {
    throw toUpdateError(err);
  }
}

export async function downloadAndInstall(
  update: Update,
  onProgress: (progress: DownloadProgress) => void,
): Promise<void> {
  await downloadUpdate(update, onProgress);
  await installUpdate(update);
}

export async function silentUpdateCheck(): Promise<UpdateCheckResult | null> {
  try {
    return await checkForUpdate();
  } catch {
    return null;
  }
}

/** Re-export proxy utilities for UI consumption */
export {
  detectFastestProxy,
  clearProxyCache,
  getCachedProxy,
  getCachedChannel,
} from './github-proxy.js';
export type { GitHubProxy } from './github-proxy.js';
