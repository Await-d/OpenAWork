import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { sqliteGet } from './db.js';
import {
  getImageProviderConfig,
  parseStoredImageGenerationDefaults,
} from './provider-config.js';
import { resolveModelRouteFromProvider } from './model-router.js';
import {
  resolveImageGenerationDefaults,
} from './image-generation/image-generation-schema.js';
import {
  generateImageWithOpenAi,
  OpenAiImageGenerationError,
} from './image-generation/openai-image-generation.js';
import { createArtifact } from './artifact-content-store.js';

const generateImageInputSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(4000)
    .describe('The text prompt describing the image to generate.'),
  size: z
    .string()
    .optional()
    .describe(
      'Image size in WxH format, e.g. "1024x1024", "1536x1024". Defaults to the user\'s configured default size.',
    ),
  quality: z
    .enum(['low', 'medium', 'high'])
    .optional()
    .describe(
      'Image quality: "low" for speed, "medium" for balance, "high" for detail. Defaults to user setting.',
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
    'Generate an image based on a text prompt using the configured image generation model. ' +
    'Use this tool when the user asks you to create, draw, design, or generate an image or picture. ' +
    'The generated image will be displayed inline in the conversation. ' +
    'You do NOT need the user to toggle image mode — this tool works directly within normal chat.',
  inputSchema: generateImageInputSchema,
  outputSchema: generateImageOutputSchema,
  timeout: 120000,
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
      output:
        '图片生成插件未启用。请在设置 → 插件中启用"图片插件"后再使用此工具。',
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
    const result = {
      success: true,
      artifactId: artifact.id,
      title: artifact.title,
      fileName: resolvedFileName,
      modelId: imageProviderConfig.modelId,
      providerId: imageProviderConfig.provider.id,
      size: resolved.size,
      quality: resolved.quality,
      outputFormat: resolved.outputFormat,
      revisedPrompt: generated.revisedPrompt ?? null,
      summary: `✅ 已生成图片（${imageProviderConfig.modelId} · ${resolved.size} · ${resolved.outputFormat.toUpperCase()}）`,
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
