import type { ProviderID } from '../schema/ids.js';
import type { BaseProvider } from './base-provider.js';
import type { ProviderConfig, ProviderInfo } from './types.js';

/**
 * 提供者注册表（单例模式）
 *
 * 管理所有已注册的 LLM 提供者，支持注册、查询、配置和切换
 */
export class ProviderRegistry {
  private static instance: ProviderRegistry | null = null;
  private providers = new Map<string, BaseProvider>();
  private activeProviderId: string | null = null;

  /**
   * 私有构造函数，确保单例模式
   */
  private constructor() {}

  /**
   * 获取注册表单例实例
   */
  static getInstance(): ProviderRegistry {
    if (!ProviderRegistry.instance) {
      ProviderRegistry.instance = new ProviderRegistry();
    }
    return ProviderRegistry.instance;
  }

  /**
   * 注册提供者
   * @param provider 提供者实例
   * @throws {Error} 如果提供者 ID 已存在
   */
  register(provider: BaseProvider): void {
    const id = provider.id;
    if (this.providers.has(id)) {
      throw new Error(`提供者 "${id}" 已注册`);
    }
    this.providers.set(id, provider);
  }

  /**
   * 批量注册提供者
   * @param providers 提供者实例数组
   */
  registerAll(providers: BaseProvider[]): void {
    for (const provider of providers) {
      this.register(provider);
    }
  }

  /**
   * 取消注册提供者
   * @param providerId 提供者 ID
   */
  unregister(providerId: string | ProviderID): void {
    const id = String(providerId);
    if (this.activeProviderId === id) {
      this.activeProviderId = null;
    }
    this.providers.delete(id);
  }

  /**
   * 获取提供者实例
   * @param providerId 提供者 ID
   * @returns 提供者实例，如果不存在返回 undefined
   */
  get(providerId: string | ProviderID): BaseProvider | undefined {
    return this.providers.get(String(providerId));
  }

  /**
   * 获取所有已注册的提供者
   */
  getAll(): BaseProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * 获取所有提供者信息
   */
  getAllInfo(): ProviderInfo[] {
    return this.getAll().map((provider) => provider.getInfo());
  }

  /**
   * 检查提供者是否已注册
   * @param providerId 提供者 ID
   */
  has(providerId: string | ProviderID): boolean {
    return this.providers.has(String(providerId));
  }

  /**
   * 配置提供者
   * @param providerId 提供者 ID
   * @param config 提供者配置
   * @throws {Error} 如果提供者不存在或配置失败
   */
  async configure(providerId: string | ProviderID, config: ProviderConfig): Promise<void> {
    const provider = this.get(providerId);
    if (!provider) {
      throw new Error(`提供者 "${providerId}" 未注册`);
    }
    await provider.configure(config);
  }

  /**
   * 设置活动提供者
   * @param providerId 提供者 ID
   * @throws {Error} 如果提供者不存在或未配置
   */
  setActive(providerId: string | ProviderID): void {
    const id = String(providerId);
    const provider = this.get(id);
    if (!provider) {
      throw new Error(`提供者 "${providerId}" 未注册`);
    }
    if (!provider.isConfigured()) {
      throw new Error(`提供者 "${providerId}" 未配置`);
    }
    this.activeProviderId = id;
  }

  /**
   * 获取活动提供者
   */
  getActive(): BaseProvider | null {
    if (!this.activeProviderId) {
      return null;
    }
    return this.get(this.activeProviderId) ?? null;
  }

  /**
   * 获取活动提供者 ID
   */
  getActiveId(): string | null {
    return this.activeProviderId;
  }

  /**
   * 清空所有提供者
   */
  clear(): void {
    this.providers.clear();
    this.activeProviderId = null;
  }

  /**
   * 获取已注册提供者数量
   */
  size(): number {
    return this.providers.size;
  }

  /**
   * 获取所有已配置的提供者
   */
  getConfigured(): BaseProvider[] {
    return this.getAll().filter((provider) => provider.isConfigured());
  }

  /**
   * 重置所有提供者配置
   */
  resetAll(): void {
    for (const provider of this.providers.values()) {
      provider.reset();
    }
    this.activeProviderId = null;
  }

  /**
   * 按 ID 列表查找提供者
   * @param providerIds 提供者 ID 列表
   */
  findByIds(providerIds: Array<string | ProviderID>): BaseProvider[] {
    return providerIds
      .map((id) => this.get(id))
      .filter((provider): provider is BaseProvider => provider !== undefined);
  }
}

/**
 * 获取全局注册表实例（便捷函数）
 */
export const getRegistry = (): ProviderRegistry => ProviderRegistry.getInstance();
