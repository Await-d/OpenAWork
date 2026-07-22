import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { supportsProxyAutoInstall, toUpdateError } from './auto-update.js';
import type { GitHubProxy, UpdateChannel } from './github-proxy.js';

const PROXY_UPDATE_EVENT = 'desktop:proxy-update-download';

type ProxyUpdateEvent =
  | {
      event: 'Started';
      data: {
        contentLength?: number;
      };
    }
  | {
      event: 'Progress';
      data: {
        chunkLength: number;
        downloaded: number;
        contentLength?: number;
      };
    };

export interface ProxyUpdateProgress {
  readonly downloaded: number;
  readonly total: number | null;
  readonly percent: number;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export async function downloadAndInstallProxyUpdate(
  proxy: GitHubProxy,
  channel: UpdateChannel,
  onProgress: (progress: ProxyUpdateProgress) => void,
): Promise<void> {
  if (!supportsProxyAutoInstall(proxy)) {
    throw toUpdateError(new Error(`代理 ${proxy.name} 当前不支持自动安装。`));
  }

  let downloaded = 0;
  let total: number | null = null;
  const unlisten = await listen<ProxyUpdateEvent>(PROXY_UPDATE_EVENT, (event) => {
    const payload = event.payload;
    if (payload.event === 'Started') {
      total = payload.data.contentLength ?? null;
      onProgress({ downloaded, total, percent: 0 });
      return;
    }

    downloaded = payload.data.downloaded;
    total = payload.data.contentLength ?? total;
    onProgress({
      downloaded,
      total,
      percent: total ? clampPercent(Math.round((downloaded / total) * 100)) : 0,
    });
  });

  try {
    await invoke<void>('download_and_install_proxy_update', {
      proxyPrefix: proxy.prefix,
      channel,
    });
    onProgress({ downloaded, total, percent: 100 });
  } catch (error) {
    throw toUpdateError(error);
  } finally {
    unlisten();
  }
}
