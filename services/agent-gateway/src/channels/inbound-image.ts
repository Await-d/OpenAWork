/**
 * 入站图片统一内联（远程 URL → base64 附件）。
 *
 * 背景：多模态协议层只接受 base64 / `data:` URL（见
 * `packages/opencode-llm/src/protocols/shared.ts` 的 `validateMedia`）。渠道
 * 若把平台的远程图片地址（企业微信 `PicUrl`、Discord / QQ CDN `url`）直接写进
 * `ChannelImageAttachment.imageUrl`，桥接层会把它当 base64 塞进 `media.data`，
 * 校验失败后**整轮请求**被拒（2026-10-22 排障包：`OpenAI Chat media must
 * contain valid base64`，上游 `V2_MODEL_ERROR`）。
 *
 * 因此所有「平台只给 URL」的通道都必须在入站阶段下载并转成 base64。本模块提供
 * 统一的下载 / 白名单 / 降级实现，避免各通道各写一份（此前 Telegram / WhatsApp
 * / Slack / 飞书各自实现，企业微信与 Discord / QQ 漏了）。
 */

import { sniffImageMediaType } from '../media/image-signature.js';
import { logGatewayWarn } from '../infra/gateway-logger.js';
import { channelFetch } from './channel-http.js';
import type { ChannelImageAttachment, ChannelMessage } from './types.js';

/** 默认入站图片上限（4 MiB）：超过则不下载，避免把大图塞进模型上下文。 */
export const DEFAULT_INBOUND_IMAGE_MAX_BYTES = 4 * 1024 * 1024;

/** 媒体请求超时：下载比普通消息慢，与 Telegram / WhatsApp 媒体一致给 30s。 */
export const INBOUND_IMAGE_TIMEOUT_MS = 30_000;

export interface DownloadInboundImageInput {
  readonly url: string;
  /** 渠道标记，仅用于日志前缀（如 `discord`）。 */
  readonly tag: string;
  readonly mimeType?: string;
  readonly fileName?: string;
  readonly maxBytes?: number;
  readonly signal?: AbortSignal;
}

/**
 * 下载一张入站图片并转为 base64 附件。
 *
 * `url` 来自入站 webhook / gateway 载荷，属于外部可控输入，因此先做协议与
 * 主机白名单校验（拒绝回环与私网地址），避免把网关当成 SSRF 跳板。
 * 任何失败都只 warn 并返回 `null`，绝不向调用方抛错。
 */
export async function downloadInboundImage(
  input: DownloadInboundImageInput,
): Promise<ChannelImageAttachment | null> {
  const maxBytes = input.maxBytes ?? DEFAULT_INBOUND_IMAGE_MAX_BYTES;
  try {
    const target = parseFetchableRemoteUrl(input.url);
    if (!target) {
      warnInboundImageSkip(input.tag, input.url, { reason: 'blocked-url' });
      return null;
    }

    const response = await channelFetch(target, {
      timeoutMs: INBOUND_IMAGE_TIMEOUT_MS,
      signal: input.signal,
    });
    if (!response.ok) {
      warnInboundImageSkip(input.tag, input.url, {
        reason: 'download-http-error',
        status: response.status,
      });
      return null;
    }

    // 声明长度已知时零拷贝短路，避免把超大图完整读进内存。
    const declaredLength = Number(response.headers.get('content-length') ?? '');
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      warnInboundImageSkip(input.tag, input.url, {
        reason: 'file-size-exceeds-limit',
        fileSize: declaredLength,
      });
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      warnInboundImageSkip(input.tag, input.url, {
        reason: 'file-size-exceeds-limit',
        fileSize: buffer.byteLength,
      });
      return null;
    }

    // 魔数优先（CDN 可能不返回准确的 content-type），再回退响应头 / 调用方声明；
    // 三者皆无则不猜测，交给调用方按「未取回」处理。
    const mediaType =
      sniffImageMediaType(buffer) ??
      normalizeImageMediaType(response.headers.get('content-type')) ??
      normalizeImageMediaType(input.mimeType);
    if (!mediaType) {
      warnInboundImageSkip(input.tag, input.url, { reason: 'unknown-media-type' });
      return null;
    }

    return {
      base64: buffer.toString('base64'),
      mediaType,
      ...(input.fileName ? { fileName: input.fileName } : {}),
    };
  } catch (err) {
    logGatewayWarn(`[${input.tag}] 入站图片下载失败`, {
      url: input.url,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export interface InlineRemoteImagesOptions {
  /** 渠道标记，仅用于日志前缀。 */
  readonly tag: string;
  readonly maxBytes?: number;
  readonly signal?: AbortSignal;
}

/**
 * 把消息里的远程图片地址批量下载成 base64 附件。
 *
 * - 无远程图片：原样返回同一对象，零网络请求（天然幂等，重复调用不重复下载）；
 * - 单张失败：丢弃该张，保留其余；
 * - 全部失败：移除 `images`（短期签名 URL 留到历史里既不会再成功，也会让上游
 *   多模态层反复拒绝该轮请求），正文里的 `[User sent an image]` 占位符仍在。
 */
export async function inlineRemoteImages(
  message: ChannelMessage,
  options: InlineRemoteImagesOptions,
): Promise<ChannelMessage> {
  const existing = message.images ?? [];
  const remoteImages = existing.filter((image) => isRemoteHttpUrl(image.imageUrl));
  if (remoteImages.length === 0) {
    return message;
  }

  const attachments: ChannelImageAttachment[] = [];
  for (const image of remoteImages) {
    const url = image.imageUrl;
    if (!url) continue;
    const attachment = await downloadInboundImage({
      url,
      tag: options.tag,
      ...(options.maxBytes !== undefined ? { maxBytes: options.maxBytes } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(image.mediaType ? { mimeType: image.mediaType } : {}),
      ...(image.fileName ? { fileName: image.fileName } : {}),
    });
    if (attachment) attachments.push(attachment);
  }

  const localImages = existing.filter((image) => !isRemoteHttpUrl(image.imageUrl));
  const nextImages = [...localImages, ...attachments];
  return nextImages.length > 0 ? { ...message, images: nextImages } : withoutImages(message);
}

/** 移除 `images` 键（保持其余字段与原型不变）。 */
export function withoutImages(message: ChannelMessage): ChannelMessage {
  const { images: _images, ...rest } = message;
  return rest;
}

export function isRemoteHttpUrl(value: string | undefined): boolean {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  return /^https?:\/\//i.test(value.trim());
}

/**
 * 消息里是否还有待内联的远程图片。
 *
 * 供调用方在**同步**路径上短路：绝大多数消息没有图片，若一律 `await` 一次
 * 异步 attach，会把「解析完立即派发」变成「多让出一拍微任务」，既拖慢投递
 * 也会打乱依赖同步派发时序的既有契约。
 */
export function hasRemoteImages(message: ChannelMessage): boolean {
  return (message.images ?? []).some((image) => isRemoteHttpUrl(image.imageUrl));
}

/** 只接受真正的 `image/*`（去掉 `; charset=` 参数），避免落到 octet-stream。 */
function normalizeImageMediaType(value: string | null | undefined): string | undefined {
  const normalized = value?.split(';')[0]?.trim().toLowerCase() ?? '';
  return normalized.startsWith('image/') ? normalized : undefined;
}

/**
 * 校验远程图片地址是否可安全下载：仅 http(s)，且不得指向回环 / 私网 / 链路本地。
 *
 * 返回校验通过的原始 URL 字符串（不做重新编码——CDN 签名参数被重编码会失效），
 * 不合法时返回 `undefined`。
 * 注：DNS 解析到私网（rebinding）无法在此层防御；这里的目的是挡掉最常见的
 * 内网探测载荷，而不是完整的出站代理。
 */
export function parseFetchableRemoteUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (isBlockedHostname(url.hostname)) return undefined;
  return trimmed;
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host.length === 0) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  // 只有 IPv6 字面量才按前缀段判定；否则 `fc2.com` 这类正常域名会被误杀。
  if (host.includes(':')) return isBlockedIpv6Literal(host);
  return isPrivateIpv4(host);
}

/** 按首 16 位判定 IPv6 字面量：`::`/`::1`、fc00::/7、fe80::/10、fec0::/10、IPv4-mapped。 */
function isBlockedIpv6Literal(host: string): boolean {
  const firstGroup = Number.parseInt(host.split(':')[0] ?? '', 16);
  // 首段为空（`::x` 形式）或无法解析时按不可信处理——覆盖回环与未指定地址。
  if (!Number.isFinite(firstGroup) || firstGroup === 0) return true;
  if ((firstGroup & 0xfe00) === 0xfc00) return true; // 唯一本地
  if ((firstGroup & 0xffc0) === 0xfe80) return true; // 链路本地
  if ((firstGroup & 0xffc0) === 0xfec0) return true; // 站点本地（已废弃，仍可能内网使用）
  if (firstGroup === 0xffff) return true;
  return false;
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [first, second] = octets as [number, number, number, number];
  if (first === 0 || first === 10 || first === 127) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  if (first === 100 && second >= 64 && second <= 127) return true;
  return false;
}

function warnInboundImageSkip(tag: string, url: string, detail: Record<string, unknown>): void {
  console.warn(`[${tag}] 入站图片下载失败`, { url, ...detail });
}
