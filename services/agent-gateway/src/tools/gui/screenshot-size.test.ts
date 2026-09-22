import { describe, expect, it } from 'vitest';
import { readImageSizeFromBase64, readImageSizeFromBuffer } from './screenshot-size.js';

/** 构造最小合法 PNG 头（签名 + IHDR chunk 开头）。 */
function makePngHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

/** 构造最小合法 GIF 头。 */
function makeGifHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(10);
  buffer.write('GIF89a', 0, 'ascii');
  buffer.writeUInt16LE(width, 6);
  buffer.writeUInt16LE(height, 8);
  return buffer;
}

/** 构造带单个 SOF0 段的 JPEG 头。 */
function makeJpegHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(20);
  buffer[0] = 0xff;
  buffer[1] = 0xd8;
  buffer[2] = 0xff;
  buffer[3] = 0xc0;
  buffer.writeUInt16BE(11, 4); // 段长度
  buffer[6] = 8; // 精度
  buffer.writeUInt16BE(height, 7);
  buffer.writeUInt16BE(width, 9);
  return buffer;
}

describe('readImageSizeFromBuffer', () => {
  it('解析 PNG IHDR 宽高', () => {
    expect(readImageSizeFromBuffer(makePngHeader(1920, 1080))).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(readImageSizeFromBuffer(makePngHeader(2880, 1800))).toEqual({
      width: 2880,
      height: 1800,
    });
  });

  it('解析 GIF 宽高', () => {
    expect(readImageSizeFromBuffer(makeGifHeader(800, 600))).toEqual({ width: 800, height: 600 });
  });

  it('解析 JPEG SOF0 宽高', () => {
    expect(readImageSizeFromBuffer(makeJpegHeader(1024, 768))).toEqual({
      width: 1024,
      height: 768,
    });
  });

  it('非图片数据返回 undefined 且不抛异常', () => {
    expect(readImageSizeFromBuffer(Buffer.from('not an image'))).toBeUndefined();
    expect(readImageSizeFromBuffer(Buffer.alloc(0))).toBeUndefined();
    expect(() => readImageSizeFromBuffer(Buffer.alloc(3))).not.toThrow();
  });

  it('PNG 签名正确但尺寸为 0 时返回 undefined', () => {
    expect(readImageSizeFromBuffer(makePngHeader(0, 0))).toBeUndefined();
  });

  it('PNG 截断（不足 24 字节）返回 undefined', () => {
    expect(readImageSizeFromBuffer(makePngHeader(1920, 1080).subarray(0, 20))).toBeUndefined();
  });
});

describe('readImageSizeFromBase64', () => {
  it('解析裸 base64', () => {
    const base64 = makePngHeader(1280, 720).toString('base64');
    expect(readImageSizeFromBase64(base64)).toEqual({ width: 1280, height: 720 });
  });

  it('解析 data URL 形态', () => {
    const base64 = makePngHeader(2560, 1440).toString('base64');
    expect(readImageSizeFromBase64(`data:image/png;base64,${base64}`)).toEqual({
      width: 2560,
      height: 1440,
    });
  });

  it('空串与非法 base64 返回 undefined', () => {
    expect(readImageSizeFromBase64('')).toBeUndefined();
    expect(readImageSizeFromBase64('   ')).toBeUndefined();
    expect(readImageSizeFromBase64('!!!not-base64!!!')).toBeUndefined();
  });
});
