import { describe, expect, it } from 'vitest';
import { sniffImageMediaType } from './image-signature.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(8)]);
const GIF = Buffer.from('GIF89a000000');
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.alloc(4),
  Buffer.from('WEBP'),
  Buffer.alloc(4),
]);
const BMP = Buffer.concat([Buffer.from('BM'), Buffer.alloc(10)]);

describe('sniffImageMediaType', () => {
  it('识别 PNG / JPEG / GIF / WebP 四种上游白名单格式', () => {
    expect(sniffImageMediaType(PNG)).toBe('image/png');
    expect(sniffImageMediaType(JPEG)).toBe('image/jpeg');
    expect(sniffImageMediaType(GIF)).toBe('image/gif');
    expect(sniffImageMediaType(WEBP)).toBe('image/webp');
  });

  it('把 BMP 也识别出来，供调用方给出「不支持」的可读错误', () => {
    expect(sniffImageMediaType(BMP)).toBe('image/bmp');
  });

  it('长度不足 12 字节或魔数未知时返回 undefined', () => {
    expect(sniffImageMediaType(Buffer.from([0x89, 0x50, 0x4e]))).toBeUndefined();
    expect(sniffImageMediaType(Buffer.alloc(16))).toBeUndefined();
    expect(sniffImageMediaType(Buffer.alloc(0))).toBeUndefined();
  });
});
