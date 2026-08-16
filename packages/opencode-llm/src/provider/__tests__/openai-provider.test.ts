import { describe, it, expect, beforeEach } from 'vitest';
import { OpenAIProvider } from '../openai-provider.js';
import type { ProviderConfig } from '../types.js';

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider();
  });

  describe('元数据', () => {
    it('应该返回正确的元数据', () => {
      const metadata = provider.getMetadata();

      expect(metadata.id).toBe('openai');
      expect(metadata.displayName).toBe('OpenAI');
      expect(metadata.requiresApiKey).toBe(true);
      expect(metadata.defaultBaseUrl).toBe('https://api.openai.com/v1');
    });

    it('应该包含支持的模型列表', () => {
      const metadata = provider.getMetadata();
      expect(metadata.supportedModels).toBeDefined();
      expect(metadata.supportedModels).toContain('gpt-4');
      expect(metadata.supportedModels).toContain('gpt-4o');
    });
  });

  describe('配置验证', () => {
    it('应该接受有效的 API Key', async () => {
      const config: ProviderConfig = {
        apiKey: 'sk-test-key-123',
      };

      await expect(provider.configure(config)).resolves.not.toThrow();
      expect(provider.isConfigured()).toBe(true);
    });

    it('应该拒绝无效的 API Key 格式', async () => {
      const config: ProviderConfig = {
        apiKey: 'invalid-key',
      };

      await expect(provider.configure(config)).rejects.toThrow('OpenAI API Key 格式无效');
    });

    it('应该接受自定义 Base URL', async () => {
      const config: ProviderConfig = {
        apiKey: 'sk-test-key-123',
        baseUrl: 'https://custom.openai.com/v1',
      };

      await expect(provider.configure(config)).resolves.not.toThrow();
    });

    it('应该拒绝无效的 Base URL', async () => {
      const config: ProviderConfig = {
        apiKey: 'sk-test-key-123',
        baseUrl: 'not-a-url',
      };

      await expect(provider.configure(config)).rejects.toThrow('Base URL 必须是有效的 URL');
    });
  });

  describe('提供者信息', () => {
    it('应该在未配置时返回正确的状态', () => {
      const info = provider.getInfo();

      expect(info.status).toBe('inactive');
      expect(info.isConfigured).toBe(false);
    });

    it('应该在配置后返回正确的状态', async () => {
      const config: ProviderConfig = {
        apiKey: 'sk-test-key-123',
      };

      await provider.configure(config);
      const info = provider.getInfo();

      expect(info.status).toBe('active');
      expect(info.isConfigured).toBe(true);
    });

    it('应该在配置失败时返回错误状态', async () => {
      const config: ProviderConfig = {
        apiKey: 'invalid-key',
      };

      try {
        await provider.configure(config);
      } catch {
        // 预期会抛出错误
      }

      const info = provider.getInfo();
      expect(info.status).toBe('error');
      expect(info.error).toBeDefined();
    });
  });

  describe('模型支持检查', () => {
    it('应该正确识别推理模型', () => {
      expect(provider.supportsReasoning('o1')).toBe(true);
      expect(provider.supportsReasoning('o1-mini')).toBe(true);
      expect(provider.supportsReasoning('o3')).toBe(true);
      expect(provider.supportsReasoning('gpt-4')).toBe(false);
    });

    it('应该正确识别视觉模型', () => {
      expect(provider.supportsVision('gpt-4')).toBe(true);
      expect(provider.supportsVision('gpt-4o')).toBe(true);
      expect(provider.supportsVision('gpt-5')).toBe(true);
      expect(provider.supportsVision('gpt-3.5-turbo')).toBe(false);
    });

    it('应该检查模型是否在支持列表中', () => {
      expect(provider.supportsModel('gpt-4')).toBe(true);
      expect(provider.supportsModel('gpt-4o')).toBe(true);
      expect(provider.supportsModel('unknown-model')).toBe(false);
    });
  });

  describe('创建模型', () => {
    it('应该在未配置时抛出错误', () => {
      expect(() => provider.createModel('gpt-4')).toThrow('提供者未配置');
    });

    it('应该在配置后创建模型', async () => {
      const config: ProviderConfig = {
        apiKey: 'sk-test-key-123',
      };

      await provider.configure(config);
      const model = provider.createModel('gpt-4');

      expect(model).toBeDefined();
      expect(model.id).toBe('gpt-4');
      expect(model.provider).toBe('openai');
    });

    it('应该将模型覆盖项传递到路由默认值', async () => {
      await provider.configure({ apiKey: 'sk-test-key-123' });

      const model = provider.createModel('gpt-4', {
        generation: { temperature: 0.2 },
      });

      expect(model.route.defaults.generation?.temperature).toBe(0.2);
    });
  });

  describe('重置', () => {
    it('应该清除配置', async () => {
      const config: ProviderConfig = {
        apiKey: 'sk-test-key-123',
      };

      await provider.configure(config);
      expect(provider.isConfigured()).toBe(true);

      provider.reset();
      expect(provider.isConfigured()).toBe(false);
      expect(provider.getConfig()).toBeNull();
    });
  });
});
