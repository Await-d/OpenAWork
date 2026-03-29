import { check, type Update } from '@tauri-apps/plugin-updater';

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
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('connect')) {
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

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  try {
    const update = await check();
    if (!update) {
      return { available: false, update: null, version: null, notes: null };
    }
    return {
      available: true,
      update,
      version: update.version,
      notes: update.body ?? null,
    };
  } catch (err) {
    throw classifyError(err);
  }
}

export async function downloadAndInstall(
  update: Update,
  onProgress: (progress: DownloadProgress) => void,
): Promise<void> {
  try {
    let downloaded = 0;
    let total: number | null = null;

    await update.downloadAndInstall((event) => {
      if (event.event === 'Started') {
        total = event.data.contentLength ?? null;
      } else if (event.event === 'Progress') {
        downloaded += event.data.chunkLength;
        onProgress({
          downloaded,
          total,
          percent: total ? Math.round((downloaded / total) * 100) : 0,
        });
      }
    });
  } catch (err) {
    throw classifyError(err);
  }
}

export async function silentUpdateCheck(): Promise<UpdateCheckResult | null> {
  try {
    return await checkForUpdate();
  } catch {
    return null;
  }
}
