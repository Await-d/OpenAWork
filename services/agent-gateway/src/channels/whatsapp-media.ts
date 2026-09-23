/**
 * WhatsApp Cloud API 媒体编解码（网络封装，不含渠道接线）。
 *
 * 入站：图片消息只带 `image.id`（媒体 ID），真实字节必须两步取回：
 * `GET ${WHATSAPP_GRAPH_API_BASE}/{mediaId}`（Bearer）返回带签名的临时下载
 * URL，再 `GET {url}`（同样带 Bearer）取二进制。两段 URL 都携带凭证语义，
 * 因此统一下载并转成 base64 附件（`ChannelImageAttachment`），下游只消费字节。
 *
 * 出站：Cloud API 没有「直接发二进制」的入口，发图 / 发文件同样两步：
 * `POST /{phoneNumberId}/media`（multipart）上传拿媒体 ID，再
 * `POST /{phoneNumberId}/messages` 按媒体 ID 发消息。multipart 的 boundary
 * 必须由 fetch 自行生成，调用方不得手动设置 `Content-Type`。
 *
 * 本模块不感知会话 / 渠道生命周期：入站失败一律 warn + 返回 `null`（调用方保留
 * `[User sent an image]` 占位符消息），绝不向调用方抛错；出站失败才抛错（发送
 * 失败必须让上层感知）。整体策略对齐 `telegram-media.ts`：入参超限零网络短路 →
 * 上游响应校验 → 下载后长度复核。
 */

import { sniffImageMediaType } from '../media/image-signature.js';
import { channelFetch } from './channel-http.js';
import { normalizeInboundRaw, readRecord, readRecordArray, readString } from './inbound-utils.js';
import type { ChannelImageAttachment, ChannelMessage } from './types.js';

/** 入站图片上限（5 MiB）：超过则不下载，避免把大图塞进模型上下文。 */
export const WHATSAPP_INBOUND_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** WhatsApp Graph API 版本基址，与渠道服务（凭证校验 / 发送）保持一致。 */
export const WHATSAPP_GRAPH_API_BASE = 'https://graph.facebook.com/v19.0';

/** 媒体请求超时：下载比普通消息慢，与飞书 / Telegram 媒体一致给 30s。 */
const WHATSAPP_MEDIA_TIMEOUT_MS = 30_000;

export interface WhatsAppInboundImageInput {
  readonly accessToken: string;
  readonly mediaId: string;
  readonly mimeType?: string;
  readonly fileName?: string;
  readonly fileSize?: number;
  readonly signal?: AbortSignal;
}

/**
 * 两步下载 WhatsApp 入站图片并转为 base64 附件。
 *
 * 任何失败（入参 / 元数据超限、上游错误、网络异常、无法判定 mediaType）都只
 * warn 并返回 `null`，绝不向调用方抛错——调用方需要保留「收到图片但未取回」
 * 的占位符消息。
 */
export async function downloadWhatsAppInboundImage(
  input: WhatsAppInboundImageInput,
): Promise<ChannelImageAttachment | null> {
  try {
    // 入参已知大小超限时直接短路，不发任何网络请求。
    if (input.fileSize !== undefined && input.fileSize > WHATSAPP_INBOUND_IMAGE_MAX_BYTES) {
      warnInboundImageSkip(input.mediaId, {
        reason: 'file-size-exceeds-limit',
        fileSize: input.fileSize,
      });
      return null;
    }

    const metadataRes = await channelFetch(`${WHATSAPP_GRAPH_API_BASE}/${input.mediaId}`, {
      headers: { Authorization: `Bearer ${input.accessToken}` },
      timeoutMs: WHATSAPP_MEDIA_TIMEOUT_MS,
      signal: input.signal,
    });
    if (!metadataRes.ok) {
      warnInboundImageSkip(input.mediaId, {
        reason: 'media-metadata-http-error',
        status: metadataRes.status,
      });
      return null;
    }

    const metadata = (await metadataRes.json()) as {
      url?: string;
      mime_type?: string;
      file_size?: number;
      error?: { message?: string };
    };
    if (metadata.error) {
      warnInboundImageSkip(input.mediaId, {
        reason: 'media-metadata-error',
        error: metadata.error.message,
      });
      return null;
    }

    const downloadUrl = metadata.url;
    if (!downloadUrl) {
      warnInboundImageSkip(input.mediaId, { reason: 'media-metadata-invalid-response' });
      return null;
    }

    if (
      typeof metadata.file_size === 'number' &&
      metadata.file_size > WHATSAPP_INBOUND_IMAGE_MAX_BYTES
    ) {
      warnInboundImageSkip(input.mediaId, {
        reason: 'file-size-exceeds-limit',
        fileSize: metadata.file_size,
      });
      return null;
    }

    // 下载 URL 内嵌临时签名，且仍要求同一个 Bearer 头，缺一不可。
    const binaryRes = await channelFetch(downloadUrl, {
      headers: { Authorization: `Bearer ${input.accessToken}` },
      timeoutMs: WHATSAPP_MEDIA_TIMEOUT_MS,
      signal: input.signal,
    });
    if (!binaryRes.ok) {
      warnInboundImageSkip(input.mediaId, {
        reason: 'download-http-error',
        status: binaryRes.status,
      });
      return null;
    }

    const buffer = Buffer.from(await binaryRes.arrayBuffer());
    if (buffer.byteLength > WHATSAPP_INBOUND_IMAGE_MAX_BYTES) {
      warnInboundImageSkip(input.mediaId, {
        reason: 'file-size-exceeds-limit',
        fileSize: buffer.byteLength,
      });
      return null;
    }

    // 魔数优先（上游可能给错 mimeType），再依次回退调用方声明与响应侧
    // mime（第二步响应头 / 元数据响应）；三者皆无则不猜测，交给调用方按
    // 「未取回」处理。
    const mediaType =
      sniffImageMediaType(buffer) ??
      input.mimeType ??
      normalizeImageMediaType(binaryRes.headers.get('content-type')) ??
      normalizeImageMediaType(metadata.mime_type);
    if (!mediaType) {
      warnInboundImageSkip(input.mediaId, { reason: 'unknown-media-type' });
      return null;
    }

    return {
      base64: buffer.toString('base64'),
      mediaType,
      ...(input.fileName ? { fileName: input.fileName } : {}),
    };
  } catch (err) {
    console.warn('[whatsapp] 入站图片下载失败', {
      mediaId: input.mediaId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * 从 `message.raw`（WhatsApp webhook 载荷）提取 image 引用并下载，返回可能带
 * `images` 的消息；提取不到 / 下载失败时原样返回入参消息（保留占位符）。
 */
export async function attachWhatsAppInboundImages(input: {
  readonly accessToken: string;
  readonly message: ChannelMessage;
}): Promise<ChannelMessage> {
  const data = normalizeInboundRaw(input.message.raw);
  const entry = readRecordArray(data, 'entry')[0] ?? null;
  const change = readRecordArray(entry, 'changes')[0] ?? null;
  const value = readRecord(change, 'value');
  const rawMessage = readRecordArray(value, 'messages')[0] ?? null;
  const image = readRecord(rawMessage, 'image');
  const mediaId = readString(image, 'id');
  if (!mediaId) {
    return input.message;
  }

  const attachment = await downloadWhatsAppInboundImage({
    accessToken: input.accessToken,
    mediaId,
    mimeType: readString(image, 'mime_type') || undefined,
  });
  if (!attachment) {
    return input.message;
  }

  return { ...input.message, images: [attachment] };
}

/** 只接受真正的 `image/*`（去掉 `; charset=` 参数），避免落到 octet-stream。 */
function normalizeImageMediaType(value: string | null | undefined): string | undefined {
  const normalized = value?.split(';')[0]?.trim().toLowerCase() ?? '';
  return normalized.startsWith('image/') ? normalized : undefined;
}

function warnInboundImageSkip(mediaId: string, detail: Record<string, unknown>): void {
  console.warn('[whatsapp] 入站图片下载失败', { mediaId, ...detail });
}

/** 出站媒体超时：multipart 上传与随后的发送都比普通消息慢，按契约给 60s。 */
const WHATSAPP_MEDIA_SEND_TIMEOUT_MS = 60_000;

export interface WhatsAppMediaSendInput {
  readonly accessToken: string;
  readonly phoneNumberId: string;
  readonly to: string;
  readonly buffer: Buffer;
  readonly fileName: string;
  readonly kind: 'image' | 'file';
  readonly caption?: string;
  readonly signal?: AbortSignal;
}

/**
 * 两步发送（上传媒体 → 发消息）；任一步失败抛错（发送失败必须可见）。
 *
 * 上传失败的错误前缀是 `WhatsApp media upload failed:`，发送失败是
 * `WhatsApp send media failed:`，两者都把上游 `error.message` 原样带出。
 */
export async function sendWhatsAppMedia(
  input: WhatsAppMediaSendInput,
): Promise<{ messageId: string }> {
  const form = new FormData();
  form.set('messaging_product', 'whatsapp');
  form.set('type', input.kind === 'image' ? 'image' : 'document');
  form.set('file', bufferToBlob(input.buffer), input.fileName);

  // 不设置 Content-Type：FormData 必须由 fetch 生成带 boundary 的头。
  const uploadRes = await channelFetch(`${WHATSAPP_GRAPH_API_BASE}/${input.phoneNumberId}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${input.accessToken}` },
    body: form,
    timeoutMs: WHATSAPP_MEDIA_SEND_TIMEOUT_MS,
    signal: input.signal,
  });
  const upload = (await uploadRes.json()) as {
    id?: string;
    error?: { message?: string };
  };
  if (!uploadRes.ok || !upload.id) {
    throw new Error(`WhatsApp media upload failed: ${upload.error?.message ?? uploadRes.status}`);
  }

  // 媒体 ID 只能用于随后的发送，故不缓存、上传后立即发消息。
  const sendBody =
    input.kind === 'image'
      ? {
          messaging_product: 'whatsapp',
          to: input.to,
          type: 'image',
          image: {
            id: upload.id,
            ...(input.caption ? { caption: input.caption } : {}),
          },
        }
      : {
          messaging_product: 'whatsapp',
          to: input.to,
          type: 'document',
          document: {
            id: upload.id,
            filename: input.fileName,
            ...(input.caption ? { caption: input.caption } : {}),
          },
        };

  const sendRes = await channelFetch(`${WHATSAPP_GRAPH_API_BASE}/${input.phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.accessToken}`,
    },
    body: JSON.stringify(sendBody),
    timeoutMs: WHATSAPP_MEDIA_SEND_TIMEOUT_MS,
    signal: input.signal,
  });
  const sent = (await sendRes.json()) as {
    messages?: Array<{ id: string }>;
    error?: { message: string };
  };
  if (sent.error || !sendRes.ok) {
    throw new Error(`WhatsApp send media failed: ${sent.error?.message ?? sendRes.status}`);
  }
  return { messageId: sent.messages?.[0]?.id ?? '' };
}

function bufferToBlob(buffer: Buffer): Blob {
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  return new Blob([bytes], { type: 'application/octet-stream' });
}
