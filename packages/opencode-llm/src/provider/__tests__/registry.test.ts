import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderRegistry } from '../registry.js';
import { OpenAIProvider } from '../openai-provider.js';
import { AnthropicProvider } from '../anthropic-provider.js';
import type { ProviderConfig } from '../types.js';

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    // 每次测试前获取新的注册表实例并清空
    registry = ProviderRegistry.getInstance();
    registry.clear();
  });

  describe('单例模式', () => {
    it('应该返回同一个实例', () => {
      const instance1 = ProviderRegistry.getInstance();
      const instance2 = ProviderRegistry.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('注册提供者', () => {
    it('应该成功注册提供者', () => {
      const provider = new OpenAIProvider();
      registry.register(provider);

      expect(registry.has('openai')).toBe(true);
      expect(registry.size()).toBe(1);
    });

    it('应该抛出错误当提供者 ID 已存在', () => {
      const provider1 = new OpenAIProvider();
      const provider2 = new OpenAIProvider();

      registry.register(provider1);
      expect(() => registry.register(provider2)).toThrow('提供者 "openai" 已注册');
    });

    it('应该支持批量注册', () => {
      const providers = [new OpenAIProvider(), new AnthropicProvider()];
      registry.registerAll(providers);

      expect(registry.size()).toBe(2);
      expect(registry.has('openai')).toBe(true);
      expect(registry.has('anthropic')).toBe(true);
    });
  });

  describe('查询提供者', () => {
    beforeEach(() => {
      registry.register(new OpenAIProvider());
      registry.register(new AnthropicProvider());
    });

    it('应该通过 ID 获取提供者', () => {
      const provider = registry.get('openai');
      expect(provider).toBeDefined();
      expect(provider?.displayName).toBe('OpenAI');
    });

    it('应该在提供者不存在时返回 undefined', () => {
      const provider = registry.get('non-existent');
      expect(provider).toBeUndefined();
    });

    it('应该获取所有提供者', () => {
      const providers = registry.getAll();
      expect(providers).toHaveLength(2);
    });

    it('应该获取所有提供者信息', () => {
      const infos = registry.getAllInfo();
      expect(infos).toHaveLength(2);
      expect(infos[0]).toHaveProperty('id');
      expect(infos[0]).toHaveProperty('displayName');
      expect(infos[0]).toHaveProperty('status');
    });
  });

  describe('配置提供者', () => {
    beforeEach(() => {
      registry.register(new OpenAIProvider());
    });

    it('应该成功配置提供者', async () => {
      const config: ProviderConfig = {
        apiKey: 'sk-test-key-123',
        baseUrl: 'https://api.openai.com/v1',
      };

      await registry.configure('openai', config);
      const provider = registry.get('openai');
      expect(provider?.isConfigured()).toBe(true);
    });

    it('应该在提供者不存在时抛出错误', async () => {
      const config: ProviderConfig = {
        apiKey: 'sk-test-key-123',
      };

      await expect(registry.configure('non-existent', config)).rejects.toThrow(
        '提供者 "non-existent" 未注册',
      );
    });

    it('应该在配置无效时抛出错误', async () => {
      const config: ProviderConfig = {
        apiKey: 'invalid-key',
      };

      await expect(registry.configure('openai', config)).rejects.toThrow();
    });
  });

  describe('活动提供者管理', () => {
    beforeEach(() => {
      registry.register(new OpenAIProvider());
      registry.register(new AnthropicProvider());
    });

    it('应该设置活动提供者', async () => {
      const config: ProviderConfig = {
        apiKey: 'sk-test-key-123',
      };

      await registry.configure('openai', config);
      registry.setActive('openai');

      expect(registry.getActiveId()).toBe('openai');
      const active = registry.getActive();
      expect(active?.displayName).toBe('OpenAI');
    });

    it('应该在提供者不存在时抛出错误', () => {
      expect(() => registry.setActive('non-existent')).toThrow('提供者 "non-existent" 未注册');
    });

    it('应该在提供者未配置时抛出错误', () => {
      expect(() => registry.setActive('openai')).toThrow('提供者 "openai" 未配置');
    });

    it('应该在没有活动提供者时返回 null', () => {
      expect(registry.getActive()).toBeNull();
      expect(registry.getActiveId()).toBeNull();
    });
  });

  describe('取消注册', () => {
    beforeEach(() => {
      registry.register(new OpenAIProvider());
    });

    it('应该成功取消注册提供者', () => {
      registry.unregister('openai');
      expect(registry.has('openai')).toBe(false);
      expect(registry.size()).toBe(0);
    });

    it('应该在取消注册活动提供者时清除活动状态', async () => {
      const config: ProviderConfig = {
        apiKey: 'sk-test-key-123',
      };

      await registry.configure('openai', config);
      registry.setActive('openai');
      registry.unregister('openai');

      expect(registry.getActiveId()).toBeNull();
    });
  });

  describe('辅助方法', () => {
    beforeEach(() => {
      registry.register(new OpenAIProvider());
      registry.register(new AnthropicProvider());
    });

    it('应该获取所有已配置的提供者', async () => {
      const config: ProviderConfig = {
        apiKey: 'sk-test-key-123',
      };

      await registry.configure('openai', config);
      const configured = registry.getConfigured();

      expect(configured).toHaveLength(1);
      expect(configured[0]?.displayName).toBe('OpenAI');
    });

    it('应该重置所有提供者配置', async () => {
      const config: ProviderConfig = {
        apiKey: 'sk-test-key-123',
      };

      await registry.configure('openai', config);
      registry.setActive('openai');
      registry.resetAll();

      expect(registry.getConfigured()).toHaveLength(0);
      expect(registry.getActiveId()).toBeNull();
    });

    it('应该按 ID 列表查找提供者', () => {
      const providers = registry.findByIds(['openai', 'anthropic']);
      expect(providers).toHaveLength(2);
    });

    it('应该过滤不存在的 ID', () => {
      const providers = registry.findByIds(['openai', 'non-existent']);
      expect(providers).toHaveLength(1);
    });
  });
});
