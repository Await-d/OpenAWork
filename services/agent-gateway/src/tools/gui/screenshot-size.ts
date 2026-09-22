/**
 * 从截图字节流推导**逻辑屏幕尺寸**。
 *
 * 背景：`desktop_control` 桥的 `ScreenshotResponse` 只返回
 * `{ success, mediaType, data, byteLength, driver }`，**不含宽高**；
 * 而 GUI 的 0–1000 归一化坐标必须换算到真实屏幕尺寸，否则点击落点会整体偏移。
 * 因此在网关侧直接从 PNG 解码宽高，避免改动桥协议。
 *
 * 支持 PNG / JPEG / GIF / WebP（覆盖 `desktop_control` 桥可能返回的格式）。
 * 纯函数、不抛异常，无法识别时返回 `undefined`，由调用方决定兜底策略。
 */
import type { GuiSize } from '@openAwork/agent-core';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 从 base64 字符串推导图片尺寸；失败返回 undefined。 */
export function readImageSizeFromBase64(dataBase64: string): GuiSize | undefined {
  const trimmed = dataBase64.trim();
  if (trimmed.length === 0) return undefined;

  // 兼容 `data:image/png;base64,xxxx` 形态
  const commaIndex = trimmed.startsWith('data:') ? trimmed.indexOf(',') : -1;
  const payload = commaIndex >= 0 ? trimmed.slice(commaIndex + 1) : trimmed;

  let buffer: Buffer;
  try {
    buffer = Buffer.from(payload, 'base64');
  } catch {
    return undefined;
  }
  if (buffer.length === 0) return undefined;

  return readImageSizeFromBuffer(buffer);
}

/** 从图片字节流推导尺寸；失败返回 undefined。 */
export function readImageSizeFromBuffer(buffer: Buffer): GuiSize | undefined {
  return readPngSize(buffer) ?? readGifSize(buffer) ?? readJpegSize(buffer) ?? readWebpSize(buffer);
}

/**
 * PNG：签名 8 字节 + IHDR chunk。
 * 结构为 `[length(4)][type(4)='IHDR'][width(4)][height(4)]`，宽高为大端无符号 32 位。
 */
function readPngSize(buffer: Buffer): GuiSize | undefined {
  if (buffer.length < 24) return undefined;
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return undefined;
  if (buffer.subarray(12, 16).toString('ascii') !== 'IHDR') return undefined;

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return isValidSize(width, height) ? { width, height } : undefined;
}

/** GIF：`GIF87a` / `GIF89a` + 小端 16 位宽高。 */
function readGifSize(buffer: Buffer): GuiSize | undefined {
  if (buffer.length < 10) return undefined;
  const header = buffer.subarray(0, 6).toString('ascii');
  if (header !== 'GIF87a' && header !== 'GIF89a') return undefined;

  const width = buffer.readUInt16LE(6);
  const height = buffer.readUInt16LE(8);
  return isValidSize(width, height) ? { width, height } : undefined;
}

/**
 * JPEG：逐段扫描直到 SOFn 帧头，再从段内读取高宽。
 * 段结构为 `0xFF <marker> <length(2, 大端)> <payload>`；SOFn 的 payload 为
 * `[precision(1)][height(2)][width(2)]`。
 */
function readJpegSize(buffer: Buffer): GuiSize | undefined {
  if (buffer.length < 4) return undefined;
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return undefined;

  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    if (marker === undefined) return undefined;

    // 填充字节与无 payload 的标记
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }

    const segmentLength = buffer.readUInt16BE(offset + 2);
    // SOF0..SOF15（排除 DHT=0xc4 / JPG=0xc8 / DAC=0xcc）
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      if (offset + 9 >= buffer.length) return undefined;
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return isValidSize(width, height) ? { width, height } : undefined;
    }

    if (segmentLength < 2) return undefined;
    offset += 2 + segmentLength;
  }
  return undefined;
}

/** WebP：`RIFF....WEBP` + VP8 / VP8L / VP8X 三种块布局。 */
function readWebpSize(buffer: Buffer): GuiSize | undefined {
  if (buffer.length < 30) return undefined;
  if (buffer.subarray(0, 4).toString('ascii') !== 'RIFF') return undefined;
  if (buffer.subarray(8, 12).toString('ascii') !== 'WEBP') return undefined;

  const chunk = buffer.subarray(12, 16).toString('ascii');
  if (chunk === 'VP8X') {
    const width = 1 + buffer.readUIntLE(24, 3);
    const height = 1 + buffer.readUIntLE(27, 3);
    return isValidSize(width, height) ? { width, height } : undefined;
  }
  if (chunk === 'VP8 ') {
    const width = buffer.readUInt16LE(26) & 0x3fff;
    const height = buffer.readUInt16LE(28) & 0x3fff;
    return isValidSize(width, height) ? { width, height } : undefined;
  }
  if (chunk === 'VP8L') {
    const bits = buffer.readUInt32LE(21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return isValidSize(width, height) ? { width, height } : undefined;
  }
  return undefined;
}

function isValidSize(width: number, height: number): boolean {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0;
}
