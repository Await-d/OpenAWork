/**
 * 媒体域 handler(261009-tool-sandbox 拆分 P2 / T-08)。
 *
 * look_at / generate_image / convert_media / extract_media_info /
 * extract_video_frame / generate_audio 六个分支体逐字搬出。
 */

import type { ToolCallResult } from '@openAwork/agent-core';
import { convertMediaToolDefinition, executeConvertMediaTool } from '../../convert-media-tool.js';
import {
  executeExtractMediaInfoTool,
  extractMediaInfoToolDefinition,
} from '../../extract-media-info-tool.js';
import {
  executeExtractVideoFrameTool,
  extractVideoFrameToolDefinition,
} from '../../extract-video-frame-tool.js';
import {
  executeGenerateAudioTool,
  generateAudioToolDefinition,
} from '../../generate-audio-tool.js';
import {
  executeGenerateImageTool,
  generateImageToolDefinition,
} from '../../image-generation-tool.js';
import { lookAtToolDefinition, runLookAtTool } from '../../look-at-tools.js';
import type { SandboxHandlerContext } from '../context.js';
import { getSessionOwnerUserId } from '../session-context.js';
import { formatToolInputValidationOutput } from '../whitelist.js';

export async function handleLookAtTool(ctx: SandboxHandlerContext): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput } = ctx;
  const userId = getSessionOwnerUserId(sessionId);
  if (!userId) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: `Session owner not found for session ${sessionId}`,
      isError: true,
      durationMs: 0,
    };
  }
  const parsed = lookAtToolDefinition.inputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
      isError: true,
      durationMs: 0,
    };
  }
  try {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: await runLookAtTool({
        filePath: parsed.data.file_path,
        goal: parsed.data.goal ?? '提取并描述文件内容',
        imageData: parsed.data.image_data,
        ...(parsed.data.offset !== undefined ? { offset: parsed.data.offset } : {}),
        parentSessionId: sessionId,
        userId,
      }),
      isError: false,
      durationMs: 0,
    };
  } catch (error) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: `Error: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
      durationMs: 0,
    };
  }
}

export async function handleGenerateImageTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput, signal } = ctx;
  const userId = getSessionOwnerUserId(sessionId);
  if (!userId) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: `Session owner not found for session ${sessionId}`,
      isError: true,
      durationMs: 0,
    };
  }
  const parsed = generateImageToolDefinition.inputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
      isError: true,
      durationMs: 0,
    };
  }
  const startAt = Date.now();
  const result = await executeGenerateImageTool({
    signal,
    sessionId,
    userId,
    toolCallId: request.toolCallId,
    toolInput: parsed.data,
  });
  return {
    toolCallId: request.toolCallId,
    toolName: request.toolName,
    output: result.output,
    isError: result.isError,
    durationMs: Date.now() - startAt,
  };
}

export async function handleConvertMediaTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput, signal } = ctx;
  const userId = getSessionOwnerUserId(sessionId);
  if (!userId) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: `Session owner not found for session ${sessionId}`,
      isError: true,
      durationMs: 0,
    };
  }
  const parsed = convertMediaToolDefinition.inputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
      isError: true,
      durationMs: 0,
    };
  }
  const convertStartAt = Date.now();
  const convertResult = await executeConvertMediaTool({
    signal,
    sessionId,
    userId,
    toolCallId: request.toolCallId,
    toolInput: parsed.data,
  });
  return {
    toolCallId: request.toolCallId,
    toolName: request.toolName,
    output: convertResult.output,
    isError: convertResult.isError,
    durationMs: Date.now() - convertStartAt,
  };
}

export async function handleExtractMediaInfoTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput, signal } = ctx;
  const userId = getSessionOwnerUserId(sessionId);
  if (!userId) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: `Session owner not found for session ${sessionId}`,
      isError: true,
      durationMs: 0,
    };
  }
  const parsed = extractMediaInfoToolDefinition.inputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
      isError: true,
      durationMs: 0,
    };
  }
  const probeStartAt = Date.now();
  const probeResult = await executeExtractMediaInfoTool({
    signal,
    sessionId,
    userId,
    toolInput: parsed.data,
  });
  return {
    toolCallId: request.toolCallId,
    toolName: request.toolName,
    output: probeResult.output,
    isError: probeResult.isError,
    durationMs: Date.now() - probeStartAt,
  };
}

export async function handleExtractVideoFrameTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput, signal } = ctx;
  const userId = getSessionOwnerUserId(sessionId);
  if (!userId) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: `Session owner not found for session ${sessionId}`,
      isError: true,
      durationMs: 0,
    };
  }
  const parsed = extractVideoFrameToolDefinition.inputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
      isError: true,
      durationMs: 0,
    };
  }
  const frameStartAt = Date.now();
  const frameResult = await executeExtractVideoFrameTool({
    signal,
    sessionId,
    userId,
    toolCallId: request.toolCallId,
    toolInput: parsed.data,
  });
  return {
    toolCallId: request.toolCallId,
    toolName: request.toolName,
    output: frameResult.output,
    isError: frameResult.isError,
    durationMs: Date.now() - frameStartAt,
  };
}

export async function handleGenerateAudioTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput, signal } = ctx;
  const userId = getSessionOwnerUserId(sessionId);
  if (!userId) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: `Session owner not found for session ${sessionId}`,
      isError: true,
      durationMs: 0,
    };
  }
  const parsed = generateAudioToolDefinition.inputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
      isError: true,
      durationMs: 0,
    };
  }
  const audioStartAt = Date.now();
  const audioResult = await executeGenerateAudioTool({
    signal,
    sessionId,
    userId,
    toolCallId: request.toolCallId,
    toolInput: parsed.data,
  });
  return {
    toolCallId: request.toolCallId,
    toolName: request.toolName,
    output: audioResult.output,
    isError: audioResult.isError,
    durationMs: Date.now() - audioStartAt,
  };
}
