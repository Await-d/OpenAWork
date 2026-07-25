import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';
import { getArtifactById } from '../session/artifact-content-store.js';
import {
  convertMedia,
  convertMediaFromUrl,
  type ConvertMediaOptions,
} from '../media/ffmpeg-bridge.js';
import { probeMediaBuffer } from '../media/ffprobe-bridge.js';
import { createMediaArtifact, extractBufferFromDataUrl } from '../media/media-artifact.js';
import { isFFmpegAvailable } from '../media/ffmpeg-bridge.js';

const convertMediaInputSchema = z.object({
  source: z.string().min(1).describe('媒体来源：artifactId、data:URL 或 HTTP/HTTPS 远程 URL'),
  targetFormat: z
    .enum([
      'mp3',
      'wav',
      'ogg',
      'aac',
      'flac',
      'm4a',
      'mp4',
      'webm',
      'mkv',
      'mov',
      'avi',
      'gif',
      'png',
      'jpg',
      'webp',
      'weba',
    ])
    .describe('目标格式'),
  videoQuality: z
    .number()
    .min(0)
    .max(51)
    .optional()
    .describe('视频编码质量 CRF 值（0-51，越低质量越高，默认 23）。仅对 H.264 视频有效'),
  audioBitrate: z.string().optional().describe('音频比特率，如 "128k"、"192k"'),
  videoScale: z
    .string()
    .optional()
    .describe('视频分辨率缩放，如 "1280:-1"（宽度 1280，高度等比缩放）'),
  videoFps: z.number().min(1).max(60).optional().describe('视频帧率'),
  startTime: z.number().min(0).optional().describe('截取起始时间（秒）'),
  duration: z.number().min(0).optional().describe('截取持续时间（秒）'),
});

const convertMediaOutputSchema = z.string();

export type ConvertMediaToolInput = z.infer<typeof convertMediaInputSchema>;

export const convertMediaToolDefinition: ToolDefinition<
  typeof convertMediaInputSchema,
  typeof convertMediaOutputSchema
> = {
  name: 'convert_media',
  description:
    '将音频、视频或图片文件从一种格式转换为另一种格式。' +
    '支持常见的音频格式（MP3/WAV/OGG/AAC/FLAC）、视频格式（MP4/WebM/MKV/MOV/AVI）和图片格式（GIF/PNG/JPEG/WebP）转换。' +
    '还可以用于裁剪视频片段（通过 startTime + duration）、调整分辨率（videoScale）、调整帧率（videoFps）等。' +
    'source 可以是之前上传或生成的 artifactId，也可以是 HTTP/HTTPS URL 或 data:URL。' +
    '转换结果会生成新的 artifact，在对话中内联展示。',
  inputSchema: convertMediaInputSchema,
  outputSchema: convertMediaOutputSchema,
  execute: async () => {
    throw new Error('convert_media must execute through the gateway-managed sandbox path');
  },
};

export async function executeConvertMediaTool(input: {
  signal?: AbortSignal;
  sessionId: string;
  userId: string;
  toolCallId: string;
  toolInput: ConvertMediaToolInput;
}): Promise<{ output: string; isError: boolean }> {
  const { signal, sessionId, userId, toolCallId, toolInput } = input;

  if (!(await isFFmpegAvailable())) {
    return {
      output: 'FFmpeg 不可用。请确保服务器已安装 ffmpeg-static 依赖。',
      isError: true,
    };
  }

  try {
    let buffer: Buffer;
    let inputMimeType: string;
    let isUrlInput = false;
    let urlSource: string | null = null;

    if (toolInput.source.startsWith('artifact:')) {
      const artifactId = toolInput.source.slice('artifact:'.length);
      const artifact = getArtifactById(userId, artifactId);
      if (!artifact) {
        return { output: `找不到 artifact: ${artifactId}`, isError: true };
      }
      const extracted = extractBufferFromDataUrl(artifact.content);
      buffer = extracted.buffer;
      inputMimeType = extracted.mimeType;
    } else if (toolInput.source.startsWith('http://') || toolInput.source.startsWith('https://')) {
      // URL 输入：使用 FFmpeg 直接流式处理（支持 HLS 等）
      isUrlInput = true;
      urlSource = toolInput.source;
      inputMimeType = guessInputMimeType(toolInput.source);
      buffer = Buffer.alloc(0);
    } else if (toolInput.source.startsWith('data:')) {
      const extracted = extractBufferFromDataUrl(toolInput.source);
      buffer = extracted.buffer;
      inputMimeType = extracted.mimeType;
    } else {
      // 尝试作为 artifactId
      const artifact = getArtifactById(userId, toolInput.source);
      if (!artifact) {
        return {
          output: `无法识别的来源: ${toolInput.source.slice(0, 100)}。请使用 artifactId、data:URL 或 HTTP/HTTPS URL。`,
          isError: true,
        };
      }
      const extracted = extractBufferFromDataUrl(artifact.content);
      buffer = extracted.buffer;
      inputMimeType = extracted.mimeType;
    }

    const options: ConvertMediaOptions = {
      targetFormat: toolInput.targetFormat,
      ...(toolInput.videoQuality !== undefined ? { videoQuality: toolInput.videoQuality } : {}),
      ...(toolInput.audioBitrate ? { audioBitrate: toolInput.audioBitrate } : {}),
      ...(toolInput.videoScale ? { videoScale: toolInput.videoScale } : {}),
      ...(toolInput.videoFps !== undefined ? { videoFps: toolInput.videoFps } : {}),
      ...(toolInput.startTime !== undefined ? { startTime: toolInput.startTime } : {}),
      ...(toolInput.duration !== undefined ? { duration: toolInput.duration } : {}),
    };

    // URL 输入直接走 FFmpeg 流式转换（支持 HLS .m3u8）
    const result =
      isUrlInput && urlSource
        ? await convertMediaFromUrl(urlSource, inputMimeType, options, signal)
        : await convertMedia(buffer, inputMimeType, options, signal);

    // 提取输出媒体信息
    let mediaInfo;
    try {
      mediaInfo = await probeMediaBuffer(result.buffer, result.outputMimeType, signal);
    } catch {
      // probe 失败不阻断
    }

    const artifactResult = createMediaArtifact({
      userId,
      sessionId,
      buffer: result.buffer,
      mimeType: result.outputMimeType,
      title: `转换结果 (${toolInput.targetFormat.toUpperCase()})`,
      mediaInfo,
      sourceKind: 'tool_convert_media',
      toolCallId,
      createdByNote: 'convert_media tool',
    });

    const summary = {
      success: true,
      artifactId: artifactResult.artifactId,
      fileName: artifactResult.fileName,
      mimeType: result.outputMimeType,
      targetFormat: toolInput.targetFormat,
      originalMimeType: inputMimeType,
      sizeBytes: result.sizeBytes,
      ...(mediaInfo?.duration ? { duration: Math.round(mediaInfo.duration * 10) / 10 } : {}),
      ...(mediaInfo?.width ? { width: mediaInfo.width } : {}),
      ...(mediaInfo?.height ? { height: mediaInfo.height } : {}),
      summary: `✅ 已将 ${inputMimeType} 转换为 ${result.outputMimeType}（${formatBytes(result.sizeBytes)}）`,
    };

    return { output: JSON.stringify(summary), isError: false };
  } catch (error) {
    return {
      output: `媒体转换失败: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function guessInputMimeType(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (lower.includes('.mp4')) return 'video/mp4';
  if (lower.includes('.webm')) return 'video/webm';
  if (lower.includes('.mkv')) return 'video/x-matroska';
  if (lower.includes('.mov')) return 'video/quicktime';
  if (lower.includes('.avi')) return 'video/x-msvideo';
  if (lower.includes('.mp3')) return 'audio/mpeg';
  if (lower.includes('.wav')) return 'audio/wav';
  if (lower.includes('.ogg')) return 'audio/ogg';
  if (lower.includes('.aac')) return 'audio/aac';
  if (lower.includes('.m4a')) return 'audio/mp4';
  if (lower.includes('.flac')) return 'audio/flac';
  if (lower.includes('.gif')) return 'image/gif';
  if (lower.includes('.png')) return 'image/png';
  if (lower.includes('.jpg') || lower.includes('.jpeg')) return 'image/jpeg';
  if (lower.includes('.webp')) return 'image/webp';
  return 'application/octet-stream';
}
