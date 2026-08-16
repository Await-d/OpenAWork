import type { Model } from '../schema/options.js';
import type { ProviderID } from '../schema/ids.js';
import type { RouteDefaultsInput } from '../route/client.js';
import type { ProviderConfig, ProviderMetadata, ProviderStatus, ProviderInfo } from './types.js';
import { ProviderConfigSchema } from './types.js';

/**
 * 提供者基类
 *
 * 所有 LLM 提供者都应继承此基类并实现抽象方法
 */
export abstract class BaseProvider {
  protected config: ProviderConfig | null = null;
  protected status: ProviderStatus = 'inactive';
  protected errorMessage?: string;

  /**
   * 获取提供者元数据
   */
  abstract getMetadata(): ProviderMetadata;

  /**
   * 创建模型实例
   * @param modelId 模型 ID
   * @param options 模型选项
   */
  abstract createModel(modelId: string, options?: RouteDefaultsInput): Model;

  /**
   * 验证配置是否有效
   * @param config 提供者配置
   */
  protected abstract validateConfig(config: ProviderConfig): Promise<boolean>;

  /**
   * 获取提供者 ID
   */
  get id(): ProviderID {
    return this.getMetadata().id;
  }

  /**
   * 获取显示名称
   */
  get displayName(): string {
    return this.getMetadata().displayName;
  }

  /**
   * 配置提供者
   * @param config 提供者配置
   * @throws {Error} 如果配置无效
   */
  async configure(config: ProviderConfig): Promise<void> {
    try {
      // 使用 Zod 校验配置
      const validatedConfig = ProviderConfigSchema.parse(config);

      // 提供者特定的校验
      const isValid = await this.validateConfig(validatedConfig);
      if (!isValid) {
        throw new Error('提供者配置验证失败');
      }

      this.config = validatedConfig;
      this.status = 'active';
      this.errorMessage = undefined;
    } catch (error) {
      this.status = 'error';
      this.errorMessage = error instanceof Error ? error.message : '配置提供者时发生未知错误';
      throw new Error(`配置提供者失败: ${this.errorMessage}`);
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): ProviderConfig | null {
    return this.config;
  }

  /**
   * 获取提供者信息
   */
  getInfo(): ProviderInfo {
    const metadata = this.getMetadata();
    return {
      ...metadata,
      status: this.status,
      isConfigured: this.config !== null,
      error: this.errorMessage,
    };
  }

  /**
   * 检查是否已配置
   */
  isConfigured(): boolean {
    return this.config !== null && this.status === 'active';
  }

  /**
   * 重置配置
   */
  reset(): void {
    this.config = null;
    this.status = 'inactive';
    this.errorMessage = undefined;
  }

  /**
   * 获取支持的模型列表
   */
  getSupportedModels(): readonly string[] {
    return this.getMetadata().supportedModels ?? [];
  }

  /**
   * 检查是否支持指定模型
   * @param modelId 模型 ID
   */
  supportsModel(modelId: string): boolean {
    const supportedModels = this.getSupportedModels();
    if (supportedModels.length === 0) {
      // 如果没有指定支持的模型列表，则认为支持所有模型
      return true;
    }
    return supportedModels.includes(modelId);
  }
}
