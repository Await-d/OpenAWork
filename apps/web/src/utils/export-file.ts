type TauriInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

declare global {
  interface Window {
    __TAURI__?: {
      readonly core?: {
        readonly invoke?: TauriInvoke;
      };
    };
  }
}

export type ExportFileResult =
  | { readonly kind: 'browser' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'desktop'; readonly path: string };

export interface ExportTextFileOptions {
  readonly content: string;
  readonly filename: string;
  readonly mimeType: string;
}

export interface ExportDataUrlFileOptions {
  readonly dataUrl: string;
  readonly filename: string;
}

export type ExportFileOptions = ExportTextFileOptions | ExportDataUrlFileOptions;

export async function exportFile(options: ExportFileOptions): Promise<ExportFileResult> {
  const tauriInvoke = window.__TAURI__?.core?.invoke;
  if (tauriInvoke) {
    const path =
      'dataUrl' in options
        ? await tauriInvoke<string | null>('save_export_file_bytes', {
            bytes: Array.from(await bytesFromDataUrl(options.dataUrl)),
            filename: options.filename,
          })
        : await tauriInvoke<string | null>('save_export_file', {
            content: options.content,
            filename: options.filename,
          });
    return path ? { kind: 'desktop', path } : { kind: 'cancelled' };
  }

  triggerBrowserDownload(options);
  return { kind: 'browser' };
}

function triggerBrowserDownload(options: ExportFileOptions): void {
  if ('dataUrl' in options) {
    const anchor = document.createElement('a');
    anchor.href = options.dataUrl;
    anchor.download = options.filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    return;
  }

  const blob = new Blob([options.content], { type: options.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = options.filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

async function bytesFromDataUrl(dataUrl: string): Promise<Uint8Array> {
  if (!dataUrl.startsWith('data:')) {
    throw new Error('无效的数据 URL');
  }
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) {
    throw new Error('无效的数据 URL');
  }
  const metadata = dataUrl.slice(5, commaIndex);
  const payload = dataUrl.slice(commaIndex + 1);
  if (metadata.split(';').includes('base64')) {
    const binary = atob(payload);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }
  return new TextEncoder().encode(decodeURIComponent(payload));
}
