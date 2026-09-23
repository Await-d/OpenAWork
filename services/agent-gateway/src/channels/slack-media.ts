/**
 * Slack 入站图片编解码（网络 + 编解码封装，不含渠道接线）。
 *
 * Slack 文件对象上的 `url_private` / `url_private_download` 是带凭证语义的
 * 私有地址：必须携带 `Authorization: Bearer <botToken>`（bot token 需要
 * `files:read` scope）才能取回。把该 URL 直接下发给模型 / 客户端等于泄露
 * 私有链接，因此这里统一下载并转成 base64 附件（`ChannelImageAttachment`），
 * 下游只消费字节、看不到 URL 与 token。
 *
 * 本模块不感知会话 / 渠道生命周期：失败一律 warn + 返回 `null`（调用方保留
 * `[User sent an image]` 占位符消息），绝不向调用方抛错。
 */

import { sniffImageMediaType } from '../media/image-signature.js';
import { channelFetch } from './channel-http.js';
import { readRecordArray, readString } from './inbound-utils.js';
import type { ChannelImageAttachment, ChannelMessage } from './types.js';

/** 入站图片上限（4 MiB）：超过则不下载，避免把大图塞进模型上下文。 */
export const SLACK_INBOUND_IMAGE_MAX_BYTES = 4 * 1024 * 1024;

/** 单条消息最多处理的图片数：与 Discord 入站一致。 */
export const SLACK_INBOUND_IMAGE_MAX_COUNT = 4;

/** 媒体请求超时：下载比普通消息慢，与 Telegram / 飞书媒体一致给 30s。 */
const SLACK_MEDIA_TIMEOUT_MS = 30_000;

/** `filetype` → MIME 映射：`mimetype` 缺失时的回退。 */
const SLACK_IMAGE_FILETYPE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

export interface SlackImageFileRef {
  readonly url: string;
  readonly mimeType: string;
  readonly fileName?: string;
  readonly fileSize?: number;
}

/**
 * 从 Bolt 消息对象读取图片文件引用（`url_private_download` 优先，回退
 * `url_private`）。非图片文件、缺少可用 URL 的条目一律跳过。
 */
export function readSlackImageFiles(raw: unknown, maxCount: number): SlackImageFileRef[] {
  const refs: SlackImageFileRef[] = [];

  for (const file of readRecordArray(raw, 'files')) {
    const mimeType = resolveSlackImageMimeType(file);
    if (!mimeType) {
      continue;
    }
    const url = readString(file, 'url_private_download') || readString(file, 'url_private');
    if (!url) {
      continue;
    }

    const fileName = readString(file, 'name');
    const size = file['size'];
    refs.push({
      url,
      mimeType,
      ...(fileName ? { fileName } : {}),
      ...(typeof size === 'number' && Number.isFinite(size) ? { fileSize: size } : {}),
    });
  }

  return refs.slice(0, maxCount);
}

/**
 * 带 Bearer token 下载单张图片并转为 base64 附件。
 *
 * 任何失败（超限 / 上游错误 / 网络异常 / 无法判定 mediaType）都只 warn 并返回
 * `null`，绝不向调用方抛错——调用方需要保留「收到图片但未取回」的占位符消息。
 */
export async function downloadSlackInboundImage(input: {
  readonly token: string;
  readonly url: string;
  readonly mimeType?: string;
  readonly fileName?: string;
  readonly fileSize?: number;
  readonly signal?: AbortSignal;
}): Promise<ChannelImageAttachment | null> {
  try {
    // 入参已知大小超限时直接短路，不发任何网络请求。
    if (input.fileSize !== undefined && input.fileSize > SLACK_INBOUND_IMAGE_MAX_BYTES) {
      warnSlackImageSkip(input.url, {
        reason: 'file-size-exceeds-limit',
        fileSize: input.fileSize,
      });
      return null;
    }

    const res = await channelFetch(input.url, {
      headers: { Authorization: `Bearer ${input.token}` },
      timeoutMs: SLACK_MEDIA_TIMEOUT_MS,
      signal: input.signal,
    });
    if (!res.ok) {
      warnSlackImageSkip(input.url, {
        reason: 'download-http-error',
        status: res.status,
        ...(res.status === 401 || res.status === 403
          ? { hint: '请确认 bot token 具备 files:read scope' }
          : {}),
      });
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > SLACK_INBOUND_IMAGE_MAX_BYTES) {
      warnSlackImageSkip(input.url, {
        reason: 'file-size-exceeds-limit',
        fileSize: buffer.byteLength,
      });
      return null;
    }

    // 魔数优先（上游可能给错 mimeType），识别不出时回退调用方声明；两者皆无
    // 则不猜测，交给调用方按「未取回」处理。
    const mediaType = sniffImageMediaType(buffer) ?? input.mimeType;
    if (!mediaType) {
      warnSlackImageSkip(input.url, { reason: 'unknown-media-type' });
      return null;
    }

    return {
      base64: buffer.toString('base64'),
      mediaType,
      ...(input.fileName ? { fileName: input.fileName } : {}),
    };
  } catch (err) {
    console.warn('[slack] 入站图片下载失败', {
      url: input.url,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * 逐张下载并附加 `images`（单张失败跳过，不影响其余）。
 *
 * `token` 为空（渠道未配置 bot token）时不做任何网络请求，原样返回；未读到
 * 图片文件或全部下载失败时同样原样返回入参消息对象。
 */
export async function attachSlackInboundImages(input: {
  readonly token: string;
  readonly message: ChannelMessage;
  readonly raw: unknown;
}): Promise<ChannelMessage> {
  const token = input.token.trim();
  if (!token) {
    return input.message;
  }

  // parser 已把 Bolt 消息对象放进 `message.raw`，优先用它；缺失时回退入参 raw。
  const files = readSlackImageFiles(input.message.raw ?? input.raw, SLACK_INBOUND_IMAGE_MAX_COUNT);
  if (files.length === 0) {
    return input.message;
  }

  const images: ChannelImageAttachment[] = [];
  for (const file of files) {
    const attachment = await downloadSlackInboundImage({
      token,
      url: file.url,
      mimeType: file.mimeType,
      ...(file.fileName ? { fileName: file.fileName } : {}),
      ...(file.fileSize !== undefined ? { fileSize: file.fileSize } : {}),
    });
    if (attachment) {
      images.push(attachment);
    }
  }

  return images.length > 0 ? { ...input.message, images } : input.message;
}

/** `mimetype` 以 `image/` 开头优先，否则按 `filetype` 白名单映射；非图片返回空串。 */
function resolveSlackImageMimeType(file: Record<string, unknown>): string {
  const declared = readString(file, 'mimetype');
  if (declared.trim().toLowerCase().startsWith('image/')) {
    return declared;
  }
  const filetype = readString(file, 'filetype').trim().toLowerCase();
  return SLACK_IMAGE_FILETYPE_MIME[filetype] ?? '';
}

function warnSlackImageSkip(url: string, detail: Record<string, unknown>): void {
  console.warn('[slack] 入站图片下载失败', { url, ...detail });
}
