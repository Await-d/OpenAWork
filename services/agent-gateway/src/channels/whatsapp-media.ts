/**
 * WhatsApp Cloud API 入站媒体编解码（网络封装，不含渠道接线）。
 *
 * 图片消息只带 `image.id`（媒体 ID），真实字节必须两步取回：
 * `GET ${WHATSAPP_GRAPH_API_BASE}/{mediaId}`（Bearer）返回带签名的临时下载
 * URL，再 `GET {url}`（同样带 Bearer）取二进制。两段 URL 都携带凭证语义，
 * 因此统一下载并转成 base64 附件（`ChannelImageAttachment`），下游只消费字节。
 *
 * 本模块不感知会话 / 渠道生命周期：入站失败一律 warn + 返回 `null`（调用方保留
 * `[User sent an image]` 占位符消息），绝不向调用方抛错。整体策略对齐
 * `telegram-media.ts`：入参超限零网络短路 → 上游响应校验 → 下载后长度复核。
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
