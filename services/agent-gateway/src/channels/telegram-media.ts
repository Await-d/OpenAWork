/**
 * Telegram 媒体编解码（网络 + 编解码封装，不含渠道接线）。
 *
 * 入站：`getFile` 只返回 `file_path`，真实文件必须从
 * `https://api.telegram.org/file/bot<token>/<file_path>` 取回。该 URL 内嵌
 * bot token，一旦下发给模型 / 客户端就等于泄露凭证，因此这里统一下载并转成
 * base64 附件（`ChannelImageAttachment`），下游只消费字节、看不到 token。
 *
 * 出站：`sendPhoto` / `sendDocument` 走 multipart（`FormData`），boundary 必须
 * 由 fetch 自行生成，调用方不得手动设置 `Content-Type`。
 *
 * 本模块不感知会话 / 渠道生命周期：入站失败一律 warn + 返回 `null`（调用方
 * 保留占位符消息），出站失败才抛错（发送失败必须让上层感知）。
 */

import { sniffImageMediaType } from '../media/image-signature.js';
import { channelFetch } from './channel-http.js';
import type { ChannelImageAttachment } from './types.js';

/** 入站图片上限（4 MiB）：超过则不下载，避免把大图塞进模型上下文。 */
export const TELEGRAM_INBOUND_IMAGE_MAX_BYTES = 4 * 1024 * 1024;

/** Telegram caption 长度上限（按 JS 字符串长度计）。 */
export const TELEGRAM_CAPTION_MAX_LENGTH = 1024;

/** 媒体请求超时：上传 / 下载都比普通消息慢，与飞书媒体一致给 30s。 */
const TELEGRAM_MEDIA_TIMEOUT_MS = 30_000;

/** 截断用省略号：单字符，恰好占 1 个 JS 长度。 */
const TELEGRAM_CAPTION_ELLIPSIS = '…';

export interface TelegramInboundImageInput {
  /** `https://api.telegram.org/bot<token>` */
  readonly apiBase: string;
  /** `https://api.telegram.org/file/bot<token>` */
  readonly fileBaseUrl: string;
  readonly fileId: string;
  readonly fileName?: string;
  readonly mimeType?: string;
  readonly fileSize?: number;
  readonly signal?: AbortSignal;
}

export interface TelegramPhotoInput {
  readonly apiBase: string;
  readonly chatId: string;
  readonly buffer: Buffer;
  readonly fileName?: string;
  readonly caption?: string;
  readonly replyToMessageId?: string;
  readonly signal?: AbortSignal;
}

export interface TelegramDocumentInput {
  /** `https://api.telegram.org/bot<token>` */
  readonly apiBase: string;
  readonly chatId: string;
  readonly buffer: Buffer;
  readonly fileName: string;
  readonly caption?: string;
  readonly signal?: AbortSignal;
}

/**
 * 下载 Telegram 入站图片并转为 base64 附件。
 *
 * 任何失败（超限 / 上游错误 / 网络异常 / 无法判定 mediaType）都只 warn 并返回
 * `null`，绝不向调用方抛错——调用方需要保留「收到图片但未取回」的占位符消息。
 */
export async function downloadTelegramInboundImage(
  input: TelegramInboundImageInput,
): Promise<ChannelImageAttachment | null> {
  try {
    // 入参已知大小超限时直接短路，不发任何网络请求。
    if (input.fileSize !== undefined && input.fileSize > TELEGRAM_INBOUND_IMAGE_MAX_BYTES) {
      warnInboundImageSkip(input.fileId, {
        reason: 'file-size-exceeds-limit',
        fileSize: input.fileSize,
      });
      return null;
    }

    const fileInfoRes = await channelFetch(
      `${input.apiBase}/getFile?file_id=${encodeURIComponent(input.fileId)}`,
      { timeoutMs: TELEGRAM_MEDIA_TIMEOUT_MS, signal: input.signal },
    );
    if (!fileInfoRes.ok) {
      warnInboundImageSkip(input.fileId, {
        reason: 'get-file-http-error',
        status: fileInfoRes.status,
      });
      return null;
    }

    const fileInfo = (await fileInfoRes.json()) as {
      ok?: boolean;
      result?: { file_path?: string; file_size?: number };
      description?: string;
    };
    const filePath = fileInfo.result?.file_path;
    if (fileInfo.ok !== true || !filePath) {
      warnInboundImageSkip(input.fileId, {
        reason: 'get-file-invalid-response',
        description: fileInfo.description,
      });
      return null;
    }

    const remoteFileSize = fileInfo.result?.file_size;
    if (typeof remoteFileSize === 'number' && remoteFileSize > TELEGRAM_INBOUND_IMAGE_MAX_BYTES) {
      warnInboundImageSkip(input.fileId, {
        reason: 'file-size-exceeds-limit',
        fileSize: remoteFileSize,
      });
      return null;
    }

    const fileRes = await channelFetch(`${input.fileBaseUrl}/${filePath}`, {
      timeoutMs: TELEGRAM_MEDIA_TIMEOUT_MS,
      signal: input.signal,
    });
    if (!fileRes.ok) {
      warnInboundImageSkip(input.fileId, {
        reason: 'download-http-error',
        status: fileRes.status,
      });
      return null;
    }

    const buffer = Buffer.from(await fileRes.arrayBuffer());
    if (buffer.byteLength > TELEGRAM_INBOUND_IMAGE_MAX_BYTES) {
      warnInboundImageSkip(input.fileId, {
        reason: 'file-size-exceeds-limit',
        fileSize: buffer.byteLength,
      });
      return null;
    }

    // 魔数优先（上游可能给错 mimeType），识别不出时回退调用方声明；两者皆无
    // 则不猜测，交给调用方按「未取回」处理。
    const mediaType = sniffImageMediaType(buffer) ?? input.mimeType;
    if (!mediaType) {
      warnInboundImageSkip(input.fileId, { reason: 'unknown-media-type' });
      return null;
    }

    return {
      base64: buffer.toString('base64'),
      mediaType,
      ...(input.fileName ? { fileName: input.fileName } : {}),
    };
  } catch (err) {
    console.warn('[telegram] 入站图片下载失败', {
      fileId: input.fileId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** 通过 multipart `sendPhoto` 发送图片；上游拒绝时抛错（发送失败必须可见）。 */
export async function sendTelegramPhoto(input: TelegramPhotoInput): Promise<{ messageId: string }> {
  const form = new FormData();
  form.set('chat_id', input.chatId);
  form.set('photo', bufferToBlob(input.buffer), input.fileName ?? 'image.png');

  const caption = truncateTelegramCaption(input.caption);
  if (caption) {
    form.set('caption', caption);
  }
  const replyToMessageId = input.replyToMessageId?.trim();
  if (replyToMessageId) {
    form.set('reply_to_message_id', replyToMessageId);
  }

  // 不设置 Content-Type：FormData 必须由 fetch 生成带 boundary 的头。
  const res = await channelFetch(`${input.apiBase}/sendPhoto`, {
    method: 'POST',
    body: form,
    timeoutMs: TELEGRAM_MEDIA_TIMEOUT_MS,
    signal: input.signal,
  });
  const data = (await res.json()) as {
    ok?: boolean;
    description?: string;
    result?: { message_id?: number };
  };
  if (data.ok !== true) {
    throw new Error(`Telegram sendPhoto failed: ${data.description ?? 'invalid response'}`);
  }
  return { messageId: String(data.result?.message_id ?? '') };
}

/** 通过 multipart `sendDocument` 发送文件；上游拒绝时抛错。 */
export async function sendTelegramDocument(
  input: TelegramDocumentInput,
): Promise<{ messageId: string }> {
  const form = new FormData();
  form.set('chat_id', input.chatId);
  form.set('document', bufferToBlob(input.buffer), input.fileName);

  const caption = truncateTelegramCaption(input.caption);
  if (caption) {
    form.set('caption', caption);
  }

  // 不设置 Content-Type：FormData 必须由 fetch 生成带 boundary 的头。
  const res = await channelFetch(`${input.apiBase}/sendDocument`, {
    method: 'POST',
    body: form,
    timeoutMs: TELEGRAM_MEDIA_TIMEOUT_MS,
    signal: input.signal,
  });
  const data = (await res.json()) as {
    ok?: boolean;
    description?: string;
    result?: { message_id?: number };
  };
  if (data.ok !== true) {
    throw new Error(`Telegram sendDocument failed: ${data.description ?? 'invalid response'}`);
  }
  return { messageId: String(data.result?.message_id ?? '') };
}

/** 超长 caption 截断到上限内（省略号占 1 个长度）。 */
function truncateTelegramCaption(caption: string | undefined): string | undefined {
  if (caption === undefined || caption.length <= TELEGRAM_CAPTION_MAX_LENGTH) {
    return caption;
  }
  return `${caption.slice(0, TELEGRAM_CAPTION_MAX_LENGTH - 1)}${TELEGRAM_CAPTION_ELLIPSIS}`;
}

function warnInboundImageSkip(fileId: string, detail: Record<string, unknown>): void {
  console.warn('[telegram] 入站图片下载失败', { fileId, ...detail });
}

function bufferToBlob(buffer: Buffer): Blob {
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  return new Blob([bytes], { type: 'application/octet-stream' });
}
