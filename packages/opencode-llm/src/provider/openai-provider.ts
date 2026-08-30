import { BaseProvider } from './base-provider.js';
import { ProviderID } from '../schema/ids.js';
import type { RouteDefaultsInput } from '../route/client.js';
import type { Model } from '../schema/options.js';
import { validateProviderBaseUrl, type ProviderConfig, type ProviderMetadata } from './types.js';
import * as OpenAI from '../providers/openai.js';

/**
 * OpenAI 提供者实现
 */
export class OpenAIProvider extends BaseProvider {
  private static readonly DEFAULT_BASE_URL = 'https://api.openai.com/v1';
  private static readonly SUPPORTED_MODELS = [
    'gpt-4',
    'gpt-4-turbo',
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-3.5-turbo',
    'o1',
    'o1-mini',
    'o3',
    'o4-mini',
    'gpt-5',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.4-nano',
    'gpt-5.5',
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
  ];

  getMetadata(): ProviderMetadata {
    return {
      id: ProviderID.make('openai'),
      displayName: 'OpenAI',
      description: 'OpenAI GPT 系列模型提供者',
      supportedModels: OpenAIProvider.SUPPORTED_MODELS,
      defaultBaseUrl: OpenAIProvider.DEFAULT_BASE_URL,
      requiresApiKey: true,
    };
  }

  protected async validateConfig(config: ProviderConfig): Promise<boolean> {
    // 验证 API Key 格式
    if (!config.apiKey.startsWith('sk-')) {
      throw new Error('OpenAI API Key 格式无效，应以 "sk-" 开头');
    }

    // 验证 Base URL（如果提供）
    validateProviderBaseUrl(config.baseUrl ?? OpenAIProvider.DEFAULT_BASE_URL, {
      allowInsecureLocalhost: config.allowInsecureLocalhost,
    });

    return true;
  }

  createModel(modelId: string, options?: RouteDefaultsInput): Model {
    if (!this.isConfigured()) {
      throw new Error('提供者未配置，请先调用 configure()');
    }

    const config = this.config!;
    const baseUrl = config.baseUrl ?? OpenAIProvider.DEFAULT_BASE_URL;

    // 使用 opencode-llm 内置的 OpenAI 提供者
    const openai = OpenAI.configure({
      ...options,
      apiKey: config.apiKey,
      baseURL: baseUrl,
      allowInsecureLocalhost: config.allowInsecureLocalhost,
      headers: options?.headers ?? config.headers,
    });

    return openai.model(modelId);
  }

  /**
   * 检查模型是否支持推理模式
   */
  supportsReasoning(modelId: string): boolean {
    const reasoningModels = ['o1', 'o1-mini', 'o3', 'o4-mini'];
    return reasoningModels.some((prefix) => modelId.startsWith(prefix));
  }

  /**
   * 检查模型是否支持视觉
   */
  supportsVision(modelId: string): boolean {
    const visionModels = ['gpt-4', 'gpt-4o', 'gpt-5'];
    return visionModels.some((prefix) => modelId.startsWith(prefix));
  }
}
