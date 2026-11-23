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

export interface ExportBlobFileOptions {
  readonly blob: Blob;
  readonly filename: string;
}

export type ExportFileOptions =
  ExportTextFileOptions | ExportDataUrlFileOptions | ExportBlobFileOptions;

export function getFileExportLabel(): '另存为' | '下载' {
  return window.__TAURI__?.core?.invoke ? '另存为' : '下载';
}

export async function exportFile(options: ExportFileOptions): Promise<ExportFileResult> {
  const tauriInvoke = window.__TAURI__?.core?.invoke;
  if (tauriInvoke) {
    const path = await invokeTauriSave(tauriInvoke, options);
    // 超大二进制文件在桌面端不内联序列化（见 MAX_TAURI_INLINE_BYTES），
    // 降级为浏览器下载后同样返回 'browser'。
    if (path !== UNSAVEABLE) {
      return path ? { kind: 'desktop', path } : { kind: 'cancelled' };
    }
  }

  triggerBrowserDownload(options);
  return { kind: 'browser' };
}

/** 哨兵：字节量超过内联上限，需降级为浏览器下载。 */
const UNSAVEABLE = Symbol('openawork.exportFile.unsaveable');

async function invokeTauriSave(
  tauriInvoke: TauriInvoke,
  options: ExportFileOptions,
): Promise<string | null | typeof UNSAVEABLE> {
  if ('dataUrl' in options) {
    const payload = bytesToInvokePayload(await bytesFromDataUrl(options.dataUrl));
    if (!payload) return UNSAVEABLE;
    return tauriInvoke<string | null>('save_export_file_bytes', {
      bytes: payload,
      filename: options.filename,
    });
  }
  if ('blob' in options) {
    const payload = bytesToInvokePayload(new Uint8Array(await options.blob.arrayBuffer()));
    if (!payload) return UNSAVEABLE;
    return tauriInvoke<string | null>('save_export_file_bytes', {
      bytes: payload,
      filename: options.filename,
    });
  }
  return tauriInvoke<string | null>('save_export_file', {
    content: options.content,
    filename: options.filename,
  });
}

/**
 * 把字节数组转成 Tauri `Vec<u8>` 能反序列化的载荷。
 *
 * Tauri 走 JSON 序列化，`Vec<u8>` 必须落地为「数字数组」，因此 `Array.from` 这一步
 * 无法省略。但 `Array.from(Uint8Array)` 会为每个字节建一个 JS number（大对象在堆上），
 * 50MB 文件即几千万个 number，容易造成明显卡顿甚至 OOM。这里对超大文件**降级为浏览器
 * 下载**（保持可解释行为）：既不静默失败，也不在桌面端制造内存尖峰。
 */
const MAX_TAURI_INLINE_BYTES = 32 * 1024 * 1024;

function bytesToInvokePayload(bytes: Uint8Array): number[] | null {
  if (bytes.byteLength > MAX_TAURI_INLINE_BYTES) return null;
  return Array.from(bytes);
}

function triggerBrowserDownload(options: ExportFileOptions): void {
  if ('dataUrl' in options) {
    triggerAnchorDownload(options.dataUrl, options.filename);
    return;
  }
  if ('blob' in options) {
    triggerAnchorDownload(URL.createObjectURL(options.blob), options.filename, true);
    return;
  }

  const blob = new Blob([options.content], { type: options.mimeType });
  triggerAnchorDownload(URL.createObjectURL(blob), options.filename, true);
}

function triggerAnchorDownload(href: string, filename: string, revoke = false): void {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  if (revoke) {
    URL.revokeObjectURL(href);
  }
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
