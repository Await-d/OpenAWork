import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { channelFetch } from './channel-http.js';

export const DEFAULT_WEIXIN_CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';

export interface WeixinUploadedMedia {
  readonly fileKey: string;
  readonly downloadEncryptedQueryParam: string;
  readonly aesKeyHex: string;
  readonly fileSize: number;
  readonly fileSizeCiphertext: number;
}

export interface WeixinMediaUploadContext {
  readonly fileKey: string;
  readonly aesKey: Buffer;
  readonly rawSize: number;
  readonly rawFileMd5: string;
  readonly fileSizeCiphertext: number;
  readonly aesKeyHex: string;
}

export function sniffImageMediaType(buffer: Buffer): string | undefined {
  if (buffer.length < 12) {
    return undefined;
  }
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return 'image/gif';
  }
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return 'image/bmp';
  }
  return undefined;
}

export function createMediaUploadContext(buffer: Buffer): WeixinMediaUploadContext {
  const aesKey = randomBytes(16);
  const rawSize = buffer.length;
  return {
    fileKey: randomBytes(16).toString('hex'),
    aesKey,
    rawSize,
    rawFileMd5: createHash('md5').update(buffer).digest('hex'),
    fileSizeCiphertext: Math.ceil((rawSize + 1) / 16) * 16,
    aesKeyHex: aesKey.toString('hex'),
  };
}

export function encodeOutboundMediaAesKey(aesKeyHex: string): string {
  return Buffer.from(aesKeyHex, 'utf8').toString('base64');
}

export async function uploadBufferToWeixinCdn(params: {
  readonly buffer: Buffer;
  readonly uploadParam?: string;
  readonly uploadFullUrl?: string;
  readonly fileKey: string;
  readonly cdnBaseUrl?: string;
  readonly aesKey: Buffer;
  readonly signal?: AbortSignal;
}): Promise<string> {
  const ciphertext = encryptAesEcb(params.buffer, params.aesKey);
  const uploadUrl = resolveUploadUrl(params);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await postCdnUpload(uploadUrl, ciphertext, params.signal);
    } catch (error) {
      if (error instanceof WeixinCdnUploadFatalError) {
        throw error;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error('Weixin CDN upload failed');
}

function resolveUploadUrl(params: {
  readonly uploadParam?: string;
  readonly uploadFullUrl?: string;
  readonly fileKey: string;
  readonly cdnBaseUrl?: string;
}): string {
  const uploadFullUrl = params.uploadFullUrl?.trim();
  if (uploadFullUrl) {
    return uploadFullUrl;
  }
  const uploadParam = params.uploadParam?.trim();
  if (!uploadParam) {
    throw new Error('Weixin CDN upload missing upload URL');
  }
  const baseUrl = (params.cdnBaseUrl || DEFAULT_WEIXIN_CDN_BASE_URL).replace(/\/+$/, '');
  return `${baseUrl}/upload?encrypted_query_param=${encodeURIComponent(
    uploadParam,
  )}&filekey=${encodeURIComponent(params.fileKey)}`;
}

async function postCdnUpload(
  url: string,
  ciphertext: Buffer,
  signal?: AbortSignal,
): Promise<string> {
  const response = await channelFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: bufferToArrayBuffer(ciphertext),
    timeoutMs: 30_000,
    signal,
  });
  if (response.status >= 400 && response.status < 500) {
    throw new WeixinCdnUploadFatalError(
      `Weixin CDN upload client error ${response.status}: ${await readUploadError(response)}`,
    );
  }
  if (response.status !== 200) {
    throw new Error(
      `Weixin CDN upload server error ${response.status}: ${await readUploadError(response)}`,
    );
  }

  const downloadParam = response.headers.get('x-encrypted-param') || '';
  if (!downloadParam) {
    throw new WeixinCdnUploadFatalError(
      'Weixin CDN upload response missing x-encrypted-param header',
    );
  }
  return downloadParam;
}

async function readUploadError(response: Response): Promise<string> {
  const headerMessage = response.headers.get('x-error-message');
  if (headerMessage) {
    return headerMessage;
  }
  return (await response.text()) || response.statusText;
}

function encryptAesEcb(buffer: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-ecb', key, null);
  return Buffer.concat([cipher.update(buffer), cipher.final()]);
}

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return copy.buffer;
}

class WeixinCdnUploadFatalError extends Error {}
