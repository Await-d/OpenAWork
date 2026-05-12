import { check, type Update } from '@tauri-apps/plugin-updater';
import { detectFastestProxy, proxyUrl, type GitHubProxy } from './github-proxy.js';

export type UpdateChannel = 'stable' | 'preview';

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
  /** Non-null when the result was obtained through a proxy */
  proxyUsed: GitHubProxy | null;
  /** Proxied download URL (available when proxyUsed is set and update is available) */
  proxiedDownloadUrl?: string;
}

export type UpdateErrorKind = 'network' | 'signature' | 'permission' | 'no_update' | 'unknown';

export class UpdateError extends Error {
  constructor(
    public readonly kind: UpdateErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'UpdateError';
  }
}

function classifyError(err: unknown): UpdateError {
  if (err instanceof UpdateError) {
    return err;
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (
    msg.includes('network') ||
    msg.includes('fetch') ||
    msg.includes('connect') ||
    msg.includes('timeout') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('ECONNREFUSED')
  ) {
    return new UpdateError('network', msg);
  }
  if (msg.includes('signature') || msg.includes('verify')) {
    return new UpdateError('signature', msg);
  }
  if (msg.includes('permission') || msg.includes('access')) {
    return new UpdateError('permission', msg);
  }
  return new UpdateError('unknown', msg);
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
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

/** The direct GitHub endpoints configured in tauri.conf.json */
const UPDATER_ENDPOINTS = [
  'https://github.com/Await-d/OpenAWork/releases/latest/download/latest.json',
  'https://github.com/Await-d/OpenAWork/releases/download/desktop-latest-preview/latest.json',
];

/** Detect current platform key for Tauri updater JSON */
function getCurrentPlatformKey(): string {
  const platform = navigator.platform?.toLowerCase() ?? '';
  if (platform.includes('win')) return 'windows-x86_64';
  if (platform.includes('mac')) {
    // Apple Silicon vs Intel - navigator doesn't reliably distinguish,
    // but aarch64 is far more common on modern Macs
    return 'darwin-aarch64';
  }
  return 'linux-x86_64';
}

/**
 * Fetch latest.json through a proxy and parse it.
 */
async function fetchUpdaterJsonViaProxy(
  proxy: GitHubProxy,
): Promise<{ json: TauriUpdaterJson; platformEntry: TauriUpdaterPlatform } | null> {
  for (const endpoint of UPDATER_ENDPOINTS) {
    const url = proxyUrl(endpoint, proxy);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
      clearTimeout(timer);
      if (!res.ok) continue;
      const json: TauriUpdaterJson = await res.json();
      if (!json.version || !json.platforms) continue;
      const platformKey = getCurrentPlatformKey();
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
  // First, try Tauri's native check (endpoints include proxies in tauri.conf.json)
  try {
    const update = await check();
    if (!update) {
      return { available: false, update: null, version: null, notes: null, proxyUsed: null };
    }
    return {
      available: true,
      update,
      version: update.version,
      notes: update.body ?? null,
      proxyUsed: null,
    };
  } catch (nativeErr) {
    const classified = classifyError(nativeErr);
    // Only fall back to proxy for network errors
    if (classified.kind !== 'network') {
      throw classified;
    }
  }

  // Fallback: probe proxies and fetch latest.json manually
  const proxy = await detectFastestProxy();
  if (!proxy) {
    throw new UpdateError('network', '无法连接到 GitHub 或任何加速镜像，请检查网络连接。');
  }

  const result = await fetchUpdaterJsonViaProxy(proxy);
  if (!result) {
    throw new UpdateError('network', `通过代理 ${proxy.name} 获取更新信息失败。`);
  }

  const { json, platformEntry } = result;
  // Rewrite the download URL to go through the proxy
  const proxiedUrl = proxyUrl(platformEntry.url, proxy);

  return {
    available: true,
    update: null, // No native Update object — will use proxy download path
    version: json.version,
    notes: json.notes ?? null,
    proxyUsed: proxy,
    proxiedDownloadUrl: proxiedUrl,
  };
}

/**
 * Download using Tauri's native Update.download() — used when check()
 * succeeded via the native path.
 */
export async function downloadUpdate(
  update: Update,
  onProgress: (progress: DownloadProgress) => void,
): Promise<void> {
  try {
    let downloaded = 0;
    let total: number | null = null;

    await update.download((event) => {
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
  } catch (err) {
    const classified = classifyError(err);
    // On download network failure, try proxy fallback
    if (classified.kind === 'network') {
      throw new UpdateError('network', '下载失败，网络不可达。请尝试使用代理更新。');
    }
    throw classified;
  }
}

/**
 * Download update file through a proxy (used when native download is unavailable).
 * Returns the downloaded bytes as an ArrayBuffer.
 */
export async function downloadUpdateViaProxy(
  downloadUrl: string,
  onProgress: (progress: DownloadProgress) => void,
): Promise<ArrayBuffer> {
  const res = await fetch(downloadUrl, { redirect: 'follow' });
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
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    downloaded += value.byteLength;
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
}

export async function installUpdate(update: Update): Promise<void> {
  try {
    await update.install();
  } catch (err) {
    throw classifyError(err);
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
export { detectFastestProxy, clearProxyCache, getCachedProxy } from './github-proxy.js';
export type { GitHubProxy } from './github-proxy.js';
