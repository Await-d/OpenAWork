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
  prompt: z.string().min(1).max(4000).describe('The text prompt describing the image to generate.'),
  size: z
    .string()
    .optional()
    .describe(
      [
        'Image size in WxH format. Pick a preset whenever possible:',
        '• 1K (default tier): "1024x1024" (1:1), "1536x1024" (3:2), "1024x1536" (2:3).',
        '• 2K (high detail; quality is auto-raised to "high"): "2048x2048" (1:1), "2048x1152" (16:9), "1152x2048" (9:16).',
        '• 4K (experimental, relay-only, may take ~6 minutes): "3840x2160" (16:9), "2160x3840" (9:16).',
        "Custom sizes are accepted but must satisfy ALL of: max edge ≤ 3840px, both width and height multiples of 16, aspect ratio ≤ 3:1, total pixels between 655,360 and 8,294,400. Defaults to the user's configured default size when omitted.",
      ].join(' '),
    ),
  quality: z
    .enum(['low', 'medium', 'high'])
    .optional()
    .describe(
      'Image quality: "low" for speed, "medium" for balance, "high" for detail. 2K/4K sizes are auto-raised to "high" by the server. Defaults to user setting.',
    ),
  outputFormat: z
    .enum(['png', 'jpeg', 'webp'])
    .optional()
    .describe(
      'Output file format: "png" (default, lossless), "jpeg" (smaller file, no transparency), "webp" (modern, smaller). Defaults to user setting.',
    ),
  background: z
    .enum(['auto', 'opaque'])
    .optional()
    .describe(
      'Background handling: "auto" lets the model decide (may produce transparency on PNG/WebP); "opaque" forces a solid background. Defaults to user setting.',
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
    'Generate an image based on a text prompt using the configured image generation model (GPT Image 2 family). ' +
    'Use this tool when the user asks you to create, draw, design, or generate an image or picture. ' +
    'The generated image will be displayed inline in the conversation. ' +
    'You do NOT need the user to toggle image mode — this tool works directly within normal chat. ' +
    'Pick the smallest size tier that satisfies the request (1K is fastest; 2K is for posters / detailed art; 4K is experimental and slow — only use 4K when the user explicitly asks for ultra-high resolution).',
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
