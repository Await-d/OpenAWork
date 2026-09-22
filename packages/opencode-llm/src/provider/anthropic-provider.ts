import { BaseProvider } from './base-provider.js';
import { ProviderID } from '../schema/ids.js';
import type { RouteDefaultsInput } from '../route/client.js';
import type { Model } from '../schema/options.js';
import type { ProviderConfig, ProviderMetadata } from './types.js';
import * as Anthropic from '../providers/anthropic.js';

/**
 * Anthropic 提供者实现
 *
 * 通过兼容层支持 Anthropic Claude 模型
 */
export class AnthropicProvider extends BaseProvider {
  private static readonly DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
  private static readonly SUPPORTED_MODELS = [
    'claude-3-opus-20240229',
    'claude-3-sonnet-20240229',
    'claude-3-haiku-20240307',
    'claude-3-5-sonnet-20240620',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-3-7-sonnet-20250219',
    'claude-sonnet-4-0',
    'claude-opus-4-0',
    'claude-haiku-4-5',
  ];

  getMetadata(): ProviderMetadata {
    return {
      id: ProviderID.make('anthropic'),
      displayName: 'Anthropic',
      description: 'Anthropic Claude 系列模型提供者',
      supportedModels: AnthropicProvider.SUPPORTED_MODELS,
      defaultBaseUrl: AnthropicProvider.DEFAULT_BASE_URL,
      requiresApiKey: true,
    };
  }

  protected async validateConfig(config: ProviderConfig): Promise<boolean> {
    // 验证 API Key 格式
    if (!config.apiKey.startsWith('sk-ant-')) {
      throw new Error('Anthropic API Key 格式无效，应以 "sk-ant-" 开头');
    }

    // 验证 Base URL（如果提供）
    const baseUrl = config.baseUrl ?? AnthropicProvider.DEFAULT_BASE_URL;
    try {
      new URL(baseUrl);
    } catch {
      throw new Error('Base URL 格式无效');
    }

    return true;
  }

  createModel(modelId: string, options?: RouteDefaultsInput): Model {
    if (!this.isConfigured()) {
      throw new Error('提供者未配置，请先调用 configure()');
    }

    const config = this.config!;
    const baseUrl = config.baseUrl ?? AnthropicProvider.DEFAULT_BASE_URL;

    // 使用 opencode-llm 内置的 Anthropic 提供者
    const anthropic = Anthropic.configure({
      ...options,
      apiKey: config.apiKey,
      baseURL: baseUrl,
      headers: options?.headers ?? config.headers,
    });

    return anthropic.model(modelId);
  }

  /**
   * 检查模型是否支持思考模式
   */
  supportsThinking(modelId: string): boolean {
    // Claude 3.7+ 和 Claude 4+ 支持思考模式
    const thinkingPatterns = [
      'claude-3-7-sonnet',
      'claude-sonnet-4',
      'claude-opus-4',
      'claude-haiku-4',
    ];
    return thinkingPatterns.some((pattern) => modelId.includes(pattern));
  }

  /**
   * 检查模型是否支持视觉
   */
  supportsVision(modelId: string): boolean {
    // 大多数 Claude 3+ 模型支持视觉
    return (
      modelId.startsWith('claude-3') ||
      (modelId.startsWith('claude-') &&
        (modelId.includes('sonnet-4') || modelId.includes('opus-4') || modelId.includes('haiku-4')))
    );
  }

  /**
   * 检查模型是否支持 GUI grounding（能输出可直接执行的屏幕坐标，即 computer use）
   *
   * 语义说明：GUI grounding ≠ 视觉能力。绝大多数支持视觉的 Claude 模型并不具备
   * 坐标级 grounding 能力，因此这里不复用 supportsVision 的宽泛判断，而是采用
   * 保守的显式白名单，默认返回 false，仅列出官方明确支持 computer use 的模型。
   */
  supportsGuiGrounding(modelId: string): boolean {
    // 官方明确支持 computer use（可输出坐标）的 Claude 模型白名单。
    const groundingModels = [
      'claude-3-5-sonnet-20241022',
      'claude-3-7-sonnet-20250219',
      'claude-sonnet-4',
      'claude-opus-4',
      'claude-haiku-4-5',
    ];
    return groundingModels.some((model) => modelId.includes(model));
  }

  /**
   * 检查模型是否支持工具调用
   */
  supportsTools(modelId: string): boolean {
    // Claude 3+ 所有模型都支持工具调用
    return (
      modelId.startsWith('claude-3') ||
      (modelId.startsWith('claude-') && (modelId.includes('-4-') || modelId.includes('-4')))
    );
  }
}
