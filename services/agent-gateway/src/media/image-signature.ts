/**
 * 图片魔数（文件头）嗅探 —— 纯函数，无副作用。
 *
 * 从 `channels/weixin-media.ts` 抽出，因为 `tools/look-at-tools.ts` 也需要它：
 * `look_at` 的 `image_data` 允许「裸 base64」，而裸 base64 没有任何文件名 /
 * content-type 可推断 MIME，只能按魔数判定。否则会推成
 * `application/octet-stream`，被上游多模态协议（只认 png/jpeg/gif/webp）拒绝。
 *
 * `image/bmp` 也在覆盖范围内：调用方据此给出「不支持 BMP」的可读错误，
 * 而不是让它静默落到兜底分支再抛难懂的异常。
 */
export function sniffImageMediaType(buffer: Buffer): string | undefined {
  if (buffer.length < 12) {
    return undefined;
  }
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return 'image/gif';
  }
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return 'image/bmp';
  }
  return undefined;
}
