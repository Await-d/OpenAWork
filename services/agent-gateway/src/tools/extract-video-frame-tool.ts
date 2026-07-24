import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';
import { getArtifactById } from '../session/artifact-content-store.js';
import {
  extractVideoFrames,
  extractVideoFramesFromUrl,
  generateThumbnail,
  isFFmpegAvailable,
} from '../media/ffmpeg-bridge.js';
import {
  createMediaArtifact,
  extractBufferFromDataUrl,
  fetchMediaFromUrl,
} from '../media/media-artifact.js';

const extractVideoFrameInputSchema = z.object({
  source: z
    .string()
    .min(1)
    .describe('视频来源：artifactId、data:URL 或 HTTP/HTTPS 远程 URL'),
  timestamp: z
    .number()
    .min(0)
    .optional()
    .describe('提取帧的时间戳（秒）。不传时默认取第 1 秒'),
  count: z
    .number()
    .min(1)
    .max(10)
    .optional()
    .describe('提取多帧时的数量（1-10），帧会在视频中均匀分布。不传时只提取一帧'),
  width: z
    .number()
    .min(16)
    .max(3840)
    .optional()
    .describe('输出帧的宽度（像素），高度自动等比缩放'),
  format: z
    .enum(['png', 'jpg'])
    .optional()
    .describe('输出图片格式：png（默认，无损）或 jpg（较小）'),
});

const extractVideoFrameOutputSchema = z.string();

export type ExtractVideoFrameToolInput = z.infer<typeof extractVideoFrameInputSchema>;

export const extractVideoFrameToolDefinition: ToolDefinition<
  typeof extractVideoFrameInputSchema,
  typeof extractVideoFrameOutputSchema
> = {
  name: 'extract_video_frame',
  description:
    '从视频中提取一帧或多帧画面作为图片。' +
    '可用于生成视频缩略图、分析视频内容、提取关键画面等。' +
    '支持指定时间戳提取单帧，或指定数量均匀提取多帧。' +
    '提取的帧会生成新的 artifact，在对话中内联展示。' +
    'source 可以是 artifactId、data:URL 或 HTTP/HTTPS URL。',
  inputSchema: extractVideoFrameInputSchema,
  outputSchema: extractVideoFrameOutputSchema,
  execute: async () => {
    throw new Error('extract_video_frame must execute through the gateway-managed sandbox path');
  },
};

export async function executeExtractVideoFrameTool(input: {
  signal?: AbortSignal;
  sessionId: string;
  userId: string;
  toolCallId: string;
  toolInput: ExtractVideoFrameToolInput;
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
    let isUrlInput = false;
    let urlSource: string | null = null;

    if (toolInput.source.startsWith('http://') || toolInput.source.startsWith('https://')) {
      // URL 输入：直接让 FFmpeg 流式读取（支持 HLS .m3u8）
      isUrlInput = true;
      urlSource = toolInput.source;
      buffer = Buffer.alloc(0);
    } else if (toolInput.source.startsWith('data:')) {
      const extracted = extractBufferFromDataUrl(toolInput.source);
      buffer = extracted.buffer;
    } else {
      const artifact = getArtifactById(userId, toolInput.source);
      if (!artifact) {
        return { output: `找不到 artifact: ${toolInput.source}`, isError: true };
      }
      const extracted = extractBufferFromDataUrl(artifact.content);
      buffer = extracted.buffer;
    }

    const frameOptions = {
      ...(toolInput.timestamp !== undefined ? { timestamp: toolInput.timestamp } : {}),
      ...(toolInput.count !== undefined ? { count: toolInput.count } : {}),
      ...(toolInput.width !== undefined ? { width: toolInput.width } : {}),
      ...(toolInput.format ? { format: toolInput.format } : {}),
    };

    const frames = isUrlInput && urlSource
      ? await extractVideoFramesFromUrl(urlSource, frameOptions, signal)
      : await extractVideoFrames(buffer, frameOptions, signal);

    if (frames.length === 0) {
      return { output: '未能从视频中提取到任何帧', isError: true };
    }

    const frameArtifacts = frames.map((frame, i) => {
      const result = createMediaArtifact({
        userId,
        sessionId,
        buffer: frame.buffer,
        mimeType: frame.mimeType,
        title: `视频帧 #${i + 1}${frame.timestamp > 0 ? ` (${Math.round(frame.timestamp)}s)` : ''}`,
        mediaInfo: { width: toolInput.width },
        sourceKind: 'tool_extract_video_frame',
        toolCallId,
        createdByNote: 'extract_video_frame tool',
      });
      return {
        artifactId: result.artifactId,
        fileName: result.fileName,
        timestamp: frame.timestamp,
        mimeType: frame.mimeType,
        sizeBytes: frame.buffer.byteLength,
      };
    });

    const summary = {
      success: true,
      frames: frameArtifacts,
      count: frameArtifacts.length,
      summary: `✅ 已从视频提取 ${frameArtifacts.length} 帧画面`,
    };

    return { output: JSON.stringify(summary), isError: false };
  } catch (error) {
    return {
      output: `视频帧提取失败: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
}

export async function executeGenerateThumbnail(input: {
  signal?: AbortSignal;
  sessionId: string;
  userId: string;
  toolCallId: string;
  videoBuffer: Buffer;
}): Promise<{ artifactId: string; dataUrl: string } | null> {
  const { signal, sessionId, userId, toolCallId, videoBuffer } = input;

  if (!(await isFFmpegAvailable())) {
    return null;
  }

  try {
    const frame = await generateThumbnail(videoBuffer, signal);
    const result = createMediaArtifact({
      userId,
      sessionId,
      buffer: frame.buffer,
      mimeType: frame.mimeType,
      title: '视频缩略图',
      sourceKind: 'tool_extract_video_frame',
      toolCallId,
      createdByNote: 'auto-generated thumbnail',
    });
    return { artifactId: result.artifactId, dataUrl: result.dataUrl };
  } catch {
    return null;
  }
}
