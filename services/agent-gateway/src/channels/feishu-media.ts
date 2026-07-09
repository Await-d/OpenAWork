import { extname } from 'node:path';
import type { FeishuFileType } from './types.js';
import { channelFetch } from './channel-http.js';
import { FEISHU_API } from './feishu-api-types.js';
import type { FeishuAuthContext } from './feishu-messaging.js';
import { sendFeishuMessage } from './feishu-messaging.js';
import {
  feishuUploadFileResponseSchema,
  feishuUploadImageResponseSchema,
} from './feishu-response-schemas.js';

const FEISHU_FILE_TYPES = ['opus', 'mp4', 'pdf', 'doc', 'xls', 'ppt', 'stream'] as const;

export function detectFeishuFileType(fileName: string): FeishuFileType {
  const extension = extname(fileName).toLowerCase().replace(/^\./, '');
  switch (extension) {
    case 'opus':
    case 'mp4':
    case 'pdf':
      return extension;
    case 'doc':
    case 'docx':
      return 'doc';
    case 'xls':
    case 'xlsx':
      return 'xls';
    case 'ppt':
    case 'pptx':
      return 'ppt';
    default:
      return 'stream';
  }
}

export function normalizeFeishuFileType(
  value: string | undefined,
  fileName: string,
): FeishuFileType {
  if (!value) {
    return detectFeishuFileType(fileName);
  }
  return isFeishuFileType(value) ? value : detectFeishuFileType(fileName);
}

function isFeishuFileType(value: string): value is FeishuFileType {
  return FEISHU_FILE_TYPES.some((fileType) => fileType === value);
}

export async function sendFeishuImage(
  auth: FeishuAuthContext,
  chatId: string,
  input: {
    readonly buffer: Buffer;
    readonly fileName?: string;
    readonly signal?: AbortSignal;
  },
): Promise<{ messageId: string }> {
  const imageKey = await uploadFeishuImage(auth, input);
  return sendFeishuMessage(auth, {
    receiveId: chatId,
    msgType: 'image',
    content: JSON.stringify({ image_key: imageKey }),
    signal: input.signal,
  });
}

export async function sendFeishuFile(
  auth: FeishuAuthContext,
  chatId: string,
  input: {
    readonly buffer: Buffer;
    readonly fileName: string;
    readonly fileType?: FeishuFileType;
    readonly signal?: AbortSignal;
  },
): Promise<{ messageId: string }> {
  const fileKey = await uploadFeishuFile(auth, {
    ...input,
    fileType: input.fileType ?? detectFeishuFileType(input.fileName),
  });
  return sendFeishuMessage(auth, {
    receiveId: chatId,
    msgType: 'file',
    content: JSON.stringify({ file_key: fileKey }),
    signal: input.signal,
  });
}

async function uploadFeishuImage(
  auth: FeishuAuthContext,
  input: {
    readonly buffer: Buffer;
    readonly fileName?: string;
    readonly signal?: AbortSignal;
  },
): Promise<string> {
  const token = await auth.getToken();
  const form = new FormData();
  form.set('image_type', 'message');
  form.set('image', bufferToBlob(input.buffer), input.fileName ?? 'image.png');
  const resp = await channelFetch(`${FEISHU_API}/im/v1/images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal: input.signal,
    timeoutMs: 30_000,
  });
  const data = feishuUploadImageResponseSchema.parse(await resp.json());
  if (data.code !== 0) {
    throw new Error(`Feishu upload image failed: ${data.msg ?? data.code}`);
  }
  if (!data.data?.image_key) {
    throw new Error('Feishu upload image succeeded but returned no image_key');
  }
  return data.data.image_key;
}

async function uploadFeishuFile(
  auth: FeishuAuthContext,
  input: {
    readonly buffer: Buffer;
    readonly fileName: string;
    readonly fileType: FeishuFileType;
    readonly signal?: AbortSignal;
  },
): Promise<string> {
  const token = await auth.getToken();
  const form = new FormData();
  form.set('file_type', input.fileType);
  form.set('file_name', input.fileName);
  form.set('file', bufferToBlob(input.buffer), input.fileName);
  const resp = await channelFetch(`${FEISHU_API}/im/v1/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal: input.signal,
    timeoutMs: 60_000,
  });
  const data = feishuUploadFileResponseSchema.parse(await resp.json());
  if (data.code !== 0) {
    throw new Error(`Feishu upload file failed: ${data.msg ?? data.code}`);
  }
  if (!data.data?.file_key) {
    throw new Error('Feishu upload file succeeded but returned no file_key');
  }
  return data.data.file_key;
}

function bufferToBlob(buffer: Buffer): Blob {
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  return new Blob([bytes], { type: 'application/octet-stream' });
}
