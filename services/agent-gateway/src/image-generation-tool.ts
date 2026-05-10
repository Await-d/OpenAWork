import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { sqliteGet } from './db.js';
import { getImageProviderConfig, parseStoredImageGenerationDefaults } from './provider-config.js';
import { resolveModelRouteFromProvider } from './model-router.js';
import { resolveImageGenerationDefaults } from './image-generation/image-generation-schema.js';
import {
  generateImageWithOpenAi,
  OpenAiImageGenerationError,
} from './image-generation/openai-image-generation.js';
import { createArtifact } from './artifact-content-store.js';

const generateImageInputSchema = z.object({
  prompt: z.string().min(1).max(4000).describe('描述要生成图片的文本 prompt。'),
  size: z
    .string()
    .optional()
    .describe(
      [
        '图片尺寸，WxH 格式。可能时优先选预设：',
        '• 1K（默认档）："1024x1024"（1:1）、"1536x1024"（3:2）、"1024x1536"（2:3）。',
        '• 2K（高细节；quality 会被服务端自动提到 "high"）："2048x2048"（1:1）、"2048x1152"（16:9）、"1152x2048"（9:16）。',
        '• 4K（实验性、仅走 relay、可能耗时 ~6 分钟）："3840x2160"（16:9）、"2160x3840"（9:16）。',
        '也接受自定义尺寸，但必须同时满足：最长边 ≤ 3840px、宽高都是 16 的倍数、长宽比 ≤ 3:1、总像素在 655,360 – 8,294,400 之间。不传时使用用户配置的默认尺寸。',
      ].join(' '),
    ),
  quality: z
    .enum(['low', 'medium', 'high'])
    .optional()
    .describe(
      '图片质量："low"重速度、"medium"平衡、"high"重细节。2K / 4K 尺寸会被服务端自动提到 "high"。不传时用用户配置。',
    ),
  outputFormat: z
    .enum(['png', 'jpeg', 'webp'])
    .optional()
    .describe(
      '输出文件格式："png"（默认，无损）、"jpeg"（文件较小、不支持透明）、"webp"（现代、较小）。不传时用用户配置。',
    ),
  background: z
    .enum(['auto', 'opaque'])
    .optional()
    .describe(
      '背景处理："auto" 由模型决定（PNG/WebP 下可能产生透明）；"opaque" 强制不透明。不传时用用户配置。',
    ),
});

const generateImageOutputSchema = z.string();

export type GenerateImageToolInput = z.infer<typeof generateImageInputSchema>;

export const generateImageToolDefinition: ToolDefinition<
  typeof generateImageInputSchema,
  typeof generateImageOutputSchema
> = {
  name: 'generate_image',
  description:
    '使用配置好的图片生成模型（GPT Image 2 系列）按文本 prompt 生成图片。' +
    '用户要你创建、画、设计、生成图片时使用本工具。' +
    '生成的图片会在对话中内联展示。' +
    '**不需要**用户切到图片模式——本工具在普通聊天中直接可用。' +
    '请选择能满足需求的最小尺寸档（1K 最快；2K 适海报 / 精细画面；4K 实验性且慢，仅在用户明确要求超高分辨率时使用）。',
  inputSchema: generateImageInputSchema,
  outputSchema: generateImageOutputSchema,
  execute: async () => {
    throw new Error('generate_image must execute through the gateway-managed sandbox path');
  },
};

interface UserSettingRow {
  value: string;
}

function parseStoredJson(value: string | undefined): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function buildImageArtifactTitle(prompt: string): string {
  const normalized = prompt.trim().replace(/\s+/g, ' ');
  if (!normalized) return '图片生成结果';
  return normalized.length > 48 ? `${normalized.slice(0, 48)}…` : normalized;
}

function buildImageFileName(prompt: string, extension: string): string {
  const base = buildImageArtifactTitle(prompt)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return `${base || 'generated-image'}-${createHash('sha1').update(prompt).digest('hex').slice(0, 8)}.${extension}`;
}

export async function executeGenerateImageTool(input: {
  signal?: AbortSignal;
  sessionId: string;
  userId: string;
  toolCallId: string;
  toolInput: GenerateImageToolInput;
}): Promise<{
  output: string;
  isError: boolean;
}> {
  const { sessionId, userId, toolCallId, toolInput } = input;

  // Check if the image generation plugin is enabled
  const pluginRow = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'plugin_settings'`,
    [userId],
  );
  const pluginSettings = parseStoredJson(pluginRow?.value) as
    | { imageGeneration?: { enabled?: boolean } }
    | undefined;
  if (!pluginSettings?.imageGeneration?.enabled) {
    return {
      output: '图片生成插件未启用。请在设置 → 插件中启用"图片插件"后再使用此工具。',
      isError: true,
    };
  }

  const providersRow = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'providers'`,
    [userId],
  );
  const selectionRow = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'active_selection'`,
    [userId],
  );
  const defaultsRow = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'image_generation_defaults'`,
    [userId],
  );

  const imageProviderConfig = await getImageProviderConfig(
    parseStoredJson(providersRow?.value),
    parseStoredJson(selectionRow?.value),
  );
  if (!imageProviderConfig) {
    return {
      output: '当前未配置可用的图片生成模型。请先在设置中配置图片模型后再使用此工具。',
      isError: true,
    };
  }

  const storedDefaults = parseStoredImageGenerationDefaults(parseStoredJson(defaultsRow?.value));
  const resolved = resolveImageGenerationDefaults(
    {
      size: toolInput.size,
      quality: toolInput.quality,
      outputFormat: toolInput.outputFormat,
      background: toolInput.background,
    },
    storedDefaults,
  );

  const route = resolveModelRouteFromProvider(
    imageProviderConfig.provider,
    imageProviderConfig.modelId,
    { maxTokens: 1, temperature: 1 },
  );

  try {
    const generated = await generateImageWithOpenAi({
      apiBaseUrl: route.apiBaseUrl,
      apiKey: route.apiKey,
      background: resolved.background,
      model: route.model,
      outputFormat: resolved.outputFormat,
      prompt: toolInput.prompt,
      providerType: route.providerType,
      quality: resolved.quality,
      requestOverrides: route.requestOverrides,
      signal: input.signal,
      size: resolved.size,
    });

    const contentBase64 = generated.bytes.toString('base64');
    const content = `data:${generated.mimeType};base64,${contentBase64}`;
    const fileExtension =
      generated.outputFormat === 'jpeg'
        ? 'jpg'
        : generated.outputFormat === 'webp'
          ? 'webp'
          : 'png';

    const artifact = createArtifact(userId, {
      sessionId,
      title: buildImageArtifactTitle(toolInput.prompt),
      content,
      type: 'image',
      fileName: buildImageFileName(toolInput.prompt, fileExtension),
      mimeType: generated.mimeType,
      metadata: {
        sourceKind: 'tool_generate_image',
        providerId: imageProviderConfig.provider.id,
        modelId: imageProviderConfig.modelId,
        prompt: toolInput.prompt,
        revisedPrompt: generated.revisedPrompt,
        size: resolved.size,
        quality: resolved.quality,
        outputFormat: resolved.outputFormat,
        background: resolved.background,
        toolCallId,
      },
      createdBy: 'agent',
      createdByNote: 'generate_image tool',
    });

    const resolvedFileName = buildImageFileName(toolInput.prompt, fileExtension);
    const summaryParts = [
      `✅ 已生成图片（${imageProviderConfig.modelId} · ${resolved.size} · ${resolved.outputFormat.toUpperCase()}）`,
    ];
    if (resolved.qualityAutoLifted) {
      summaryParts.push(
        `（已自动将 quality 从 ${resolved.requestedQuality} 提升到 high，因为 ${resolved.size} 属于 2K/4K 档位）`,
      );
    }
    const result = {
      success: true,
      artifactId: artifact.id,
      title: artifact.title,
      fileName: resolvedFileName,
      modelId: imageProviderConfig.modelId,
      providerId: imageProviderConfig.provider.id,
      size: resolved.size,
      quality: resolved.quality,
      requestedQuality: resolved.requestedQuality,
      qualityAutoLifted: resolved.qualityAutoLifted,
      outputFormat: resolved.outputFormat,
      background: resolved.background,
      revisedPrompt: generated.revisedPrompt ?? null,
      summary: summaryParts.join(''),
    };

    return { output: JSON.stringify(result), isError: false };
  } catch (error) {
    if (error instanceof OpenAiImageGenerationError) {
      return {
        output: `图片生成失败: ${error.message}`,
        isError: true,
      };
    }

    return {
      output: `图片生成失败，请稍后重试。${error instanceof Error ? ` (${error.message})` : ''}`,
      isError: true,
    };
  }
}
