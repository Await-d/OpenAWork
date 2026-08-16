import { describe, it, expect, beforeEach } from 'vitest';
import { AnthropicProvider } from '../anthropic-provider.js';
import type { ProviderConfig } from '../types.js';

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    provider = new AnthropicProvider();
  });

  describe('元数据', () => {
    it('应该返回正确的元数据', () => {
      const metadata = provider.getMetadata();

      expect(metadata.id).toBe('anthropic');
      expect(metadata.displayName).toBe('Anthropic');
      expect(metadata.requiresApiKey).toBe(true);
      expect(metadata.defaultBaseUrl).toBe('https://api.anthropic.com/v1');
    });

    it('应该包含支持的模型列表', () => {
      const metadata = provider.getMetadata();
      expect(metadata.supportedModels).toBeDefined();
      expect(metadata.supportedModels).toContain('claude-3-opus-20240229');
      expect(metadata.supportedModels).toContain('claude-sonnet-4-0');
    });
  });

  describe('配置验证', () => {
    it('应该接受有效的 API Key', async () => {
      const config: ProviderConfig = {
        apiKey: 'sk-ant-test-key-123',
      };

      await expect(provider.configure(config)).resolves.not.toThrow();
      expect(provider.isConfigured()).toBe(true);
    });

    it('应该拒绝无效的 API Key 格式', async () => {
      const config: ProviderConfig = {
        apiKey: 'invalid-key',
      };

      await expect(provider.configure(config)).rejects.toThrow('Anthropic API Key 格式无效');
    });

    it('应该拒绝 OpenAI 格式的 API Key', async () => {
      const config: ProviderConfig = {
        apiKey: 'sk-test-key-123',
      };

      await expect(provider.configure(config)).rejects.toThrow('Anthropic API Key 格式无效');
    });

    it('应该接受自定义 Base URL', async () => {
      const config: ProviderConfig = {
        apiKey: 'sk-ant-test-key-123',
        baseUrl: 'https://custom.anthropic.com/v1',
      };

      await expect(provider.configure(config)).resolves.not.toThrow();
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
        apiKey: 'sk-ant-test-key-123',
      };

      await provider.configure(config);
      const info = provider.getInfo();

      expect(info.status).toBe('active');
      expect(info.isConfigured).toBe(true);
    });
  });

  describe('模型能力检查', () => {
    it('应该正确识别支持思考模式的模型', () => {
      expect(provider.supportsThinking('claude-3-7-sonnet-20250219')).toBe(true);
      expect(provider.supportsThinking('claude-sonnet-4-0')).toBe(true);
      expect(provider.supportsThinking('claude-opus-4-0')).toBe(true);
      expect(provider.supportsThinking('claude-3-opus-20240229')).toBe(false);
    });

    it('应该正确识别支持视觉的模型', () => {
      expect(provider.supportsVision('claude-3-opus-20240229')).toBe(true);
      expect(provider.supportsVision('claude-3-sonnet-20240229')).toBe(true);
      expect(provider.supportsVision('claude-sonnet-4-0')).toBe(true);
    });

    it('应该正确识别支持工具调用的模型', () => {
      expect(provider.supportsTools('claude-3-opus-20240229')).toBe(true);
      expect(provider.supportsTools('claude-sonnet-4-0')).toBe(true);
      expect(provider.supportsTools('claude-haiku-4-5')).toBe(true);
    });

    it('应该检查模型是否在支持列表中', () => {
      expect(provider.supportsModel('claude-3-opus-20240229')).toBe(true);
      expect(provider.supportsModel('claude-sonnet-4-0')).toBe(true);
      expect(provider.supportsModel('unknown-model')).toBe(false);
    });
  });

  describe('创建模型', () => {
    it('应该在未配置时抛出错误', () => {
      expect(() => provider.createModel('claude-3-opus-20240229')).toThrow('提供者未配置');
    });

    it('应该在配置后创建模型', async () => {
      const config: ProviderConfig = {
        apiKey: 'sk-ant-test-key-123',
      };

      await provider.configure(config);
      const model = provider.createModel('claude-3-opus-20240229');

      expect(model).toBeDefined();
      expect(model.id).toBe('claude-3-opus-20240229');
      expect(model.provider).toBe('anthropic');
    });

    it('应该将模型覆盖项传递到路由默认值', async () => {
      await provider.configure({ apiKey: 'sk-ant-test-key-123' });

      const model = provider.createModel('claude-3-opus-20240229', {
        generation: { maxTokens: 256 },
      });

      expect(model.route.defaults.generation?.maxTokens).toBe(256);
    });
  });

  describe('重置', () => {
    it('应该清除配置', async () => {
      const config: ProviderConfig = {
        apiKey: 'sk-ant-test-key-123',
      };

      await provider.configure(config);
      expect(provider.isConfigured()).toBe(true);

      provider.reset();
      expect(provider.isConfigured()).toBe(false);
      expect(provider.getConfig()).toBeNull();
    });
  });
});
