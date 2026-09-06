import { readFile } from 'node:fs/promises';
import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';
import { getArtifactById } from '../session/artifact-content-store.js';
import { probeMediaBuffer, probeMediaUrl, isFFprobeAvailable } from '../media/ffprobe-bridge.js';
import { extractBufferFromDataUrl, fetchMediaFromUrl } from '../media/media-artifact.js';
import { inferMimeTypeFromExtension } from '../media/media-codec.js';
import { assertSessionWorkspacePath } from '../workspace/workspace-safety.js';

function isHlsUrl(url: string): boolean {
  return url.toLowerCase().includes('.m3u8');
}

const extractMediaInfoInputSchema = z.object({
  source: z
    .string()
    .min(1)
    .describe('媒体来源：工作区文件路径、artifactId、data:URL 或 HTTP/HTTPS 远程 URL'),
});

const extractMediaInfoOutputSchema = z.string();

export type ExtractMediaInfoToolInput = z.infer<typeof extractMediaInfoInputSchema>;

export const extractMediaInfoToolDefinition: ToolDefinition<
  typeof extractMediaInfoInputSchema,
  typeof extractMediaInfoOutputSchema
> = {
  name: 'extract_media_info',
  description:
    '提取音频、视频或图片文件的详细元信息。' +
    '包括媒体类型、时长、分辨率、编码格式、比特率、采样率、声道数、帧率等。' +
    '在需要了解媒体文件详细参数时使用此工具（例如判断视频分辨率、音频时长、编码格式等）。' +
    'source 可以是当前会话工作区文件路径、artifactId、data:URL 或 HTTP/HTTPS URL。',
  inputSchema: extractMediaInfoInputSchema,
  outputSchema: extractMediaInfoOutputSchema,
  execute: async () => {
    throw new Error('extract_media_info must execute through the gateway-managed sandbox path');
  },
};

export async function executeExtractMediaInfoTool(input: {
  signal?: AbortSignal;
  sessionId: string;
  userId: string;
  toolInput: ExtractMediaInfoToolInput;
}): Promise<{ output: string; isError: boolean }> {
  const { signal, sessionId, userId, toolInput } = input;

  if (!(await isFFprobeAvailable())) {
    return {
      output: 'FFprobe 不可用。请确保服务器已安装 ffprobe-static 依赖。',
      isError: true,
    };
  }

  try {
    let buffer: Buffer;
    let mimeType: string;

    if (toolInput.source.startsWith('http://') || toolInput.source.startsWith('https://')) {
      // HLS 流直接用 ffprobe 探测 URL（无法先下载为 Buffer）
      if (isHlsUrl(toolInput.source)) {
        const hlsInfo = await probeMediaUrl(
          toolInput.source,
          'application/vnd.apple.mpegurl',
          signal,
        );
        const summary = {
          success: true,
          type: hlsInfo.type,
          mimeType: hlsInfo.mimeType,
          duration: Math.round(hlsInfo.duration * 100) / 100,
          ...(hlsInfo.width ? { width: hlsInfo.width } : {}),
          ...(hlsInfo.height ? { height: hlsInfo.height } : {}),
          ...(hlsInfo.codec ? { codec: hlsInfo.codec } : {}),
          ...(hlsInfo.audioCodec ? { audioCodec: hlsInfo.audioCodec } : {}),
          ...(hlsInfo.videoCodec ? { videoCodec: hlsInfo.videoCodec } : {}),
          ...(hlsInfo.bitrate ? { bitrate: hlsInfo.bitrate } : {}),
          ...(hlsInfo.sampleRate ? { sampleRate: hlsInfo.sampleRate } : {}),
          ...(hlsInfo.channels ? { channels: hlsInfo.channels } : {}),
          ...(hlsInfo.fps ? { fps: hlsInfo.fps } : {}),
          sizeBytes: hlsInfo.sizeBytes,
          ...(hlsInfo.format ? { format: hlsInfo.format } : {}),
          summary: formatMediaSummary(hlsInfo),
        };
        return { output: JSON.stringify(summary), isError: false };
      }

      // 非 HLS 的普通 URL：先下载再探测
      const fetched = await fetchMediaFromUrl(toolInput.source, signal);
      buffer = fetched.buffer;
      mimeType = fetched.mimeType;
    } else if (toolInput.source.startsWith('data:')) {
      const extracted = extractBufferFromDataUrl(toolInput.source);
      buffer = extracted.buffer;
      mimeType = extracted.mimeType;
    } else if (
      toolInput.source.includes('/') ||
      toolInput.source.includes('\\') ||
      inferMimeTypeFromExtension(toolInput.source) !== undefined
    ) {
      const filePath = assertSessionWorkspacePath({ path: toolInput.source, sessionId });
      buffer = await readFile(filePath);
      mimeType = inferMimeTypeFromExtension(filePath) ?? 'application/octet-stream';
    } else {
      const artifact = getArtifactById(userId, toolInput.source);
      if (!artifact) {
        return { output: `找不到 artifact: ${toolInput.source}`, isError: true };
      }
      const extracted = extractBufferFromDataUrl(artifact.content);
      buffer = extracted.buffer;
      mimeType = extracted.mimeType;
    }

    const info = await probeMediaBuffer(buffer, mimeType, signal);

    const summary = {
      success: true,
      type: info.type,
      mimeType: info.mimeType,
      duration: Math.round(info.duration * 100) / 100,
      ...(info.width ? { width: info.width } : {}),
      ...(info.height ? { height: info.height } : {}),
      ...(info.codec ? { codec: info.codec } : {}),
      ...(info.audioCodec ? { audioCodec: info.audioCodec } : {}),
      ...(info.videoCodec ? { videoCodec: info.videoCodec } : {}),
      ...(info.bitrate ? { bitrate: info.bitrate } : {}),
      ...(info.sampleRate ? { sampleRate: info.sampleRate } : {}),
      ...(info.channels ? { channels: info.channels } : {}),
      ...(info.fps ? { fps: info.fps } : {}),
      sizeBytes: info.sizeBytes,
      ...(info.format ? { format: info.format } : {}),
      summary: formatMediaSummary(info),
    };

    return { output: JSON.stringify(summary), isError: false };
  } catch (error) {
    return {
      output: `媒体信息提取失败: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
}

function formatMediaSummary(info: {
  type: string;
  mimeType: string;
  duration: number;
  width?: number;
  height?: number;
  codec?: string;
  sizeBytes: number;
}): string {
  const parts: string[] = [`类型: ${info.type}`, `MIME: ${info.mimeType}`];
  if (info.duration > 0) {
    const mins = Math.floor(info.duration / 60);
    const secs = Math.round(info.duration % 60);
    parts.push(`时长: ${mins}:${secs.toString().padStart(2, '0')}`);
  }
  if (info.width && info.height) {
    parts.push(`分辨率: ${info.width}×${info.height}`);
  }
  if (info.codec) {
    parts.push(`编码: ${info.codec}`);
  }
  if (info.sizeBytes > 0) {
    parts.push(`大小: ${formatBytes(info.sizeBytes)}`);
  }
  return parts.join(' · ');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
