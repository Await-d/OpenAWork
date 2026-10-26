/**
 * 企业微信入站媒体编解码（网络 + 编解码封装，不含渠道接线）。
 *
 * 入站：图片消息只带 `PicUrl`（企业微信托管的远程临时地址），没有字节流。
 * 该地址若原样下发给模型，会被多模态协议层当成 base64 校验并拒绝整轮请求
 * （2026-10-22 排障包命中：`ProviderShared.request: OpenAI Chat media must
 * contain valid base64`，上游错误码 V2_MODEL_ERROR）。因此与 Telegram /
 * WhatsApp 一致：在 enrich 阶段下载成 base64 附件，下游只消费字节。
 *
 * 下载 / 白名单 / 降级逻辑在 `inbound-image.ts`，这里只保留企业微信特有的
 * 「PicUrl 可能藏在 raw 里」的提取规则。
 */

import { normalizeInboundRaw, readString } from './inbound-utils.js';
import {
  DEFAULT_INBOUND_IMAGE_MAX_BYTES,
  downloadInboundImage,
  inlineRemoteImages,
  isRemoteHttpUrl,
  withoutImages,
} from './inbound-image.js';
import type { ChannelImageAttachment, ChannelMessage } from './types.js';

export { parseFetchableRemoteUrl } from './inbound-image.js';

/** 入站图片上限（4 MiB）：超过则不下载，避免把大图塞进模型上下文。 */
export const WECOM_INBOUND_IMAGE_MAX_BYTES = DEFAULT_INBOUND_IMAGE_MAX_BYTES;

const WECOM_MEDIA_TAG = 'wecom';

export interface WeComInboundImageInput {
  readonly picUrl: string;
  readonly mimeType?: string;
  readonly fileName?: string;
  readonly signal?: AbortSignal;
}

/** 下载单张企业微信入站图片（失败返回 `null`，不抛错）。 */
export async function downloadWeComInboundImage(
  input: WeComInboundImageInput,
): Promise<ChannelImageAttachment | null> {
  return downloadInboundImage({
    url: input.picUrl,
    tag: WECOM_MEDIA_TAG,
    maxBytes: WECOM_INBOUND_IMAGE_MAX_BYTES,
    ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    ...(input.fileName ? { fileName: input.fileName } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });
}

/**
 * 把消息里的远程图片地址（`PicUrl`）替换成 base64 附件。
 *
 * - 无远程图片：原样返回同一对象，零网络请求；
 * - 下载成功：`images` 换成仅含 base64 的附件；
 * - 下载失败：移除远程地址而非原样保留（短期临时链接留到历史里既不会再被
 *   下载成功，也会让上游多模态层反复拒绝该轮请求）。正文里的
 *   `[User sent an image]` 占位符仍在，模型知道用户发过图。
 */
export async function attachWeComInboundImages(message: ChannelMessage): Promise<ChannelMessage> {
  const existingImages = message.images ?? [];
  // 已有远程图：走统一的批量内联（含「全部失败则移除」的降级语义）。
  if (existingImages.some((image) => isRemoteHttpUrl(image.imageUrl))) {
    return inlineRemoteImages(message, {
      tag: WECOM_MEDIA_TAG,
      maxBytes: WECOM_INBOUND_IMAGE_MAX_BYTES,
    });
  }
  // 已经是 base64 附件：不再处理（enrich 可能在 HTTP 入站与 relay 两条路径上
  // 各跑一次，重复下载同一张图既浪费流量也会让 PicUrl 更快失效）。
  if (existingImages.length > 0) {
    return message;
  }

  // parser 尚未产出 images 的旧 / 手工构造消息：回退到 raw 里的 PicUrl。
  const data = normalizeInboundRaw(message.raw);
  const rawPicUrl = readString(data, 'PicUrl');
  if (!rawPicUrl) {
    return message;
  }

  const attachment = await downloadWeComInboundImage({
    picUrl: rawPicUrl,
    mimeType: 'image/jpeg',
  });
  return attachment ? { ...message, images: [attachment] } : withoutImages(message);
}
