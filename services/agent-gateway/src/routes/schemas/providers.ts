/**
 * 方案 4：Provider 相关 API Schema 定义
 *
 * 集中定义 provider 路由的请求/响应 schema，
 * 可被 OpenAPI 文档生成器和前端 SDK 消费。
 */
import { z } from 'zod';
import {
  providerSettingsBodySchema,
  providerSettingsQuerySchema,
  defaultThinkingSettingsSchema,
  imageGenerationDefaultsSchema,
  aiProviderSchema,
  activeSelectionSchema,
} from '../../provider/provider-config.js';

export const getProvidersSchema = {
  querystring: providerSettingsQuerySchema,
  response: {
    200: z.object({
      providers: z.array(aiProviderSchema),
      activeSelection: activeSelectionSchema,
      defaultThinking: defaultThinkingSettingsSchema,
      imageGenerationDefaults: imageGenerationDefaultsSchema,
    }),
  },
} as const;

export const putProvidersSchema = {
  body: providerSettingsBodySchema,
  response: {
    200: z.object({
      providers: z.array(aiProviderSchema),
      activeSelection: activeSelectionSchema,
      defaultThinking: defaultThinkingSettingsSchema,
      imageGenerationDefaults: imageGenerationDefaultsSchema,
    }),
  },
} as const;

export const getActiveSelectionSchema = {
  response: {
    200: z.object({
      activeSelection: activeSelectionSchema,
    }),
  },
} as const;

export const putActiveSelectionSchema = {
  body: z.object({
    activeSelection: activeSelectionSchema,
  }),
  response: {
    200: z.object({
      activeSelection: activeSelectionSchema,
    }),
  },
} as const;
