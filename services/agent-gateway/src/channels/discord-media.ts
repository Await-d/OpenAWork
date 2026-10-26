/**
 * Discord 入站媒体：CDN 附件 URL → base64 附件。
 *
 * Discord 的 `MESSAGE_CREATE` 只给附件 URL（`cdn.discordapp.com` / `proxy_url`），
 * 没有字节流。早期实现为「直映射 URL、不下载」，理由是避免 base64 入库膨胀；
 * 但多模态协议层只接受 base64 / `data:`（`validateMedia`），URL 直通会让整轮
 * 请求被拒（2026-10-22 排障包同源缺陷，与企业微信 / QQ 一致）。
 *
 * 现在的取舍：仍然不把 URL 留在库里，但改成在投递前下载成 base64（4 MiB 上限，
 * 单张失败丢弃该张），既能让模型看到图，也不会让历史里堆着 24h 后必然失效的
 * 签名链接。体积由请求级 inline image budget 兜底。
 */

import { DEFAULT_INBOUND_IMAGE_MAX_BYTES, inlineRemoteImages } from './inbound-image.js';
import type { ChannelMessage } from './types.js';

/** 单张入站图片上限（4 MiB）。 */
export const DISCORD_INBOUND_IMAGE_MAX_BYTES = DEFAULT_INBOUND_IMAGE_MAX_BYTES;

/** 把 `message.images` 里的 CDN 地址下载成 base64；全部失败则移除 `images`。 */
export async function attachDiscordInboundImages(message: ChannelMessage): Promise<ChannelMessage> {
  return inlineRemoteImages(message, {
    tag: 'discord',
    maxBytes: DISCORD_INBOUND_IMAGE_MAX_BYTES,
  });
}
