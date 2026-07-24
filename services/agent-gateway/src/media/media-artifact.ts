/**
 * 媒体 artifact 管理 —— 将媒体处理的输入/输出以 artifact 形式存储。
 *
 * 媒体 artifact 包含 base64 编码的内容（data:URL 形式），存储在
 * artifact-content-store 中，可通过 artifactId 检索。
 */

import { createArtifact } from '../session/artifact-content-store.js';
import { getExtensionForMime } from './media-codec.js';
import type { MediaInfo } from './ffprobe-bridge.js';

export interface MediaArtifactInput {
  userId: string;
  sessionId: string;
  buffer: Buffer;
  mimeType: string;
  title: string;
  fileName?: string;
  mediaInfo?: Partial<MediaInfo>;
  sourceKind?: string;
  toolCallId?: string;
  createdBy?: 'agent' | 'user' | 'system';
  createdByNote?: string;
}

export interface MediaArtifactResult {
  artifactId: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
  metadata: Record<string, unknown>;
}

/**
 * 将媒体 Buffer 存储为 artifact，返回 artifactId 和相关信息。
 */
export function createMediaArtifact(input: MediaArtifactInput): MediaArtifactResult {
  const base64 = input.buffer.toString('base64');
  const dataUrl = `data:${input.mimeType};base64,${base64}`;
  const extension = getExtensionForMime(input.mimeType);

  const fileName = input.fileName
    ?? `${input.title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-').replace(/^-+|-+$/g, '') || 'media'}.${extension}`;

  const metadata: Record<string, unknown> = {
    mimeType: input.mimeType,
    sizeBytes: input.buffer.byteLength,
    ...(input.sourceKind ? { sourceKind: input.sourceKind } : {}),
    ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
    ...(input.mediaInfo?.duration ? { duration: input.mediaInfo.duration } : {}),
    ...(input.mediaInfo?.width ? { width: input.mediaInfo.width } : {}),
    ...(input.mediaInfo?.height ? { height: input.mediaInfo.height } : {}),
    ...(input.mediaInfo?.codec ? { codec: input.mediaInfo.codec } : {}),
    ...(input.mediaInfo?.audioCodec ? { audioCodec: input.mediaInfo.audioCodec } : {}),
    ...(input.mediaInfo?.videoCodec ? { videoCodec: input.mediaInfo.videoCodec } : {}),
    ...(input.mediaInfo?.bitrate ? { bitrate: input.mediaInfo.bitrate } : {}),
    ...(input.mediaInfo?.sampleRate ? { sampleRate: input.mediaInfo.sampleRate } : {}),
    ...(input.mediaInfo?.channels ? { channels: input.mediaInfo.channels } : {}),
    ...(input.mediaInfo?.fps ? { fps: input.mediaInfo.fps } : {}),
  };

  const artifact = createArtifact(input.userId, {
    sessionId: input.sessionId,
    title: input.title,
    content: dataUrl,
    type: 'image',
    fileName,
    mimeType: input.mimeType,
    metadata,
    createdBy: input.createdBy ?? 'agent',
    createdByNote: input.createdByNote ?? null,
  });

  return {
    artifactId: artifact.id,
    title: artifact.title,
    fileName,
    mimeType: input.mimeType,
    sizeBytes: input.buffer.byteLength,
    dataUrl,
    metadata,
  };
}

/**
 * 从 URL 获取媒体数据并转为 Buffer。
 */
export async function fetchMediaFromUrl(
  url: string,
  signal?: AbortSignal,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`下载媒体失败: HTTP ${response.status}`);
  }

  const mimeType = response.headers.get('content-type') ?? 'application/octet-stream';
  const buffer = Buffer.from(await response.arrayBuffer());

  return { buffer, mimeType };
}

/**
 * 从 artifactId 获取的 artifact 数据中提取 Buffer。
 * artifact.content 格式为 `data:<mimeType>;base64,<base64data>`
 */
export function extractBufferFromDataUrl(dataUrl: string): { buffer: Buffer; mimeType: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match || match.length < 3) {
    throw new Error('无效的 data:URL 格式');
  }

  const mimeType = match[1]!;
  const buffer = Buffer.from(match[2]!, 'base64');

  return { buffer, mimeType };
}
