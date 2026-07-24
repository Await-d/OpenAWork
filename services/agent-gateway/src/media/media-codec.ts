/**
 * MIME → FFmpeg 编码器/格式映射表。
 *
 * 用于 convert_media 工具和 media-artifact 模块在输入/输出之间
 * 做 MIME ↔ codec 的双向解析。
 */

export type MediaCategory = 'audio' | 'video' | 'image';

export interface CodecMapping {
  category: MediaCategory;
  audioCodec?: string;
  videoCodec?: string;
  extension: string;
  description: string;
}

/** 常见 MIME → 编码器映射 */
export const MIME_TO_CODEC: Record<string, CodecMapping> = {
  // 音频
  'audio/mpeg': { category: 'audio', audioCodec: 'libmp3lame', extension: 'mp3', description: 'MP3 音频' },
  'audio/mp3': { category: 'audio', audioCodec: 'libmp3lame', extension: 'mp3', description: 'MP3 音频' },
  'audio/wav': { category: 'audio', audioCodec: 'pcm_s16le', extension: 'wav', description: 'WAV 无损音频' },
  'audio/x-wav': { category: 'audio', audioCodec: 'pcm_s16le', extension: 'wav', description: 'WAV 无损音频' },
  'audio/ogg': { category: 'audio', audioCodec: 'libvorbis', extension: 'ogg', description: 'Ogg Vorbis 音频' },
  'audio/aac': { category: 'audio', audioCodec: 'aac', extension: 'aac', description: 'AAC 音频' },
  'audio/flac': { category: 'audio', audioCodec: 'flac', extension: 'flac', description: 'FLAC 无损音频' },
  'audio/webm': { category: 'audio', audioCodec: 'libopus', extension: 'weba', description: 'WebM 音频' },
  'audio/mp4': { category: 'audio', audioCodec: 'aac', extension: 'm4a', description: 'MP4 音频' },

  // 视频
  'video/mp4': { category: 'video', videoCodec: 'libx264', audioCodec: 'aac', extension: 'mp4', description: 'MP4 视频' },
  'video/webm': { category: 'video', videoCodec: 'libvpx-vp9', audioCodec: 'libopus', extension: 'webm', description: 'WebM 视频' },
  'video/x-matroska': { category: 'video', videoCodec: 'libx264', audioCodec: 'aac', extension: 'mkv', description: 'Matroska 视频' },
  'video/quicktime': { category: 'video', videoCodec: 'libx264', audioCodec: 'aac', extension: 'mov', description: 'QuickTime 视频' },
  'video/x-msvideo': { category: 'video', videoCodec: 'libx264', audioCodec: 'aac', extension: 'avi', description: 'AVI 视频' },
  'video/x-flv': { category: 'video', videoCodec: 'libx264', audioCodec: 'aac', extension: 'flv', description: 'Flash 视频' },

  // 图片（用于 GIF 转换等）
  'image/gif': { category: 'image', videoCodec: 'gif', extension: 'gif', description: 'GIF 动画' },
  'image/png': { category: 'image', videoCodec: 'png', extension: 'png', description: 'PNG 图片' },
  'image/jpeg': { category: 'image', videoCodec: 'mjpeg', extension: 'jpg', description: 'JPEG 图片' },
  'image/webp': { category: 'image', videoCodec: 'libwebp', extension: 'webp', description: 'WebP 图片' },
};

/** 目标格式 → MIME 映射（用于 convert_media 的 targetFormat 参数） */
export const FORMAT_TO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  aac: 'audio/aac',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  weba: 'audio/webm',
  gif: 'image/gif',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** 根据文件名推断 MIME 类型 */
export function inferMimeTypeFromExtension(fileName: string): string | undefined {
  const lower = fileName.toLowerCase();
  const ext = lower.slice(lower.lastIndexOf('.') + 1);
  for (const [mime, mapping] of Object.entries(MIME_TO_CODEC)) {
    if (mapping.extension === ext) {
      return mime;
    }
  }
  return undefined;
}

/** 根据 MIME 获取媒体类别 */
export function getMediaCategory(mimeType: string): MediaCategory | undefined {
  return MIME_TO_CODEC[mimeType]?.category
    ?? (mimeType.startsWith('audio/') ? 'audio'
      : mimeType.startsWith('video/') ? 'video'
      : mimeType.startsWith('image/') ? 'image'
      : undefined);
}

/** 根据 MIME 获取文件扩展名 */
export function getExtensionForMime(mimeType: string): string {
  return MIME_TO_CODEC[mimeType]?.extension ?? 'bin';
}
