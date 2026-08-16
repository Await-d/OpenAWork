import { describe, it, expect } from 'vitest';
import { ProviderConfigSchema } from '../types.js';

describe('ProviderConfigSchema', () => {
  describe('API Key 验证', () => {
    it('应该接受有效的 API Key', () => {
      const config = {
        apiKey: 'sk-test-key-123',
      };

      expect(() => ProviderConfigSchema.parse(config)).not.toThrow();
    });

    it('应该拒绝空 API Key', () => {
      const config = {
        apiKey: '',
      };

      expect(() => ProviderConfigSchema.parse(config)).toThrow('API Key 不能为空');
    });

    it('应该拒绝缺失 API Key', () => {
      const config = {};

      expect(() => ProviderConfigSchema.parse(config)).toThrow();
    });
  });

  describe('Base URL 验证', () => {
    it('应该接受有效的 Base URL', () => {
      const config = {
        apiKey: 'sk-test-key-123',
        baseUrl: 'https://api.example.com/v1',
      };

      expect(() => ProviderConfigSchema.parse(config)).not.toThrow();
    });

    it('应该拒绝无效的 Base URL', () => {
      const config = {
        apiKey: 'sk-test-key-123',
        baseUrl: 'not-a-url',
      };

      expect(() => ProviderConfigSchema.parse(config)).toThrow('Base URL 必须是有效的 URL');
    });

    it('应该允许 Base URL 为空', () => {
      const config = {
        apiKey: 'sk-test-key-123',
      };

      const result = ProviderConfigSchema.parse(config);
      expect(result.baseUrl).toBeUndefined();
    });
  });

  describe('超时配置', () => {
    it('应该使用默认超时值', () => {
      const config = {
        apiKey: 'sk-test-key-123',
      };

      const result = ProviderConfigSchema.parse(config);
      expect(result.timeout).toBe(60000);
    });

    it('应该接受自定义超时值', () => {
      const config = {
        apiKey: 'sk-test-key-123',
        timeout: 30000,
      };

      const result = ProviderConfigSchema.parse(config);
      expect(result.timeout).toBe(30000);
    });

    it('应该拒绝负数超时值', () => {
      const config = {
        apiKey: 'sk-test-key-123',
        timeout: -1000,
      };

      expect(() => ProviderConfigSchema.parse(config)).toThrow();
    });

    it('应该拒绝非整数超时值', () => {
      const config = {
        apiKey: 'sk-test-key-123',
        timeout: 1000.5,
      };

      expect(() => ProviderConfigSchema.parse(config)).toThrow();
    });
  });

  describe('重试配置', () => {
    it('应该使用默认重试次数', () => {
      const config = {
        apiKey: 'sk-test-key-123',
      };

      const result = ProviderConfigSchema.parse(config);
      expect(result.maxRetries).toBe(3);
    });

    it('应该接受自定义重试次数', () => {
      const config = {
        apiKey: 'sk-test-key-123',
        maxRetries: 5,
      };

      const result = ProviderConfigSchema.parse(config);
      expect(result.maxRetries).toBe(5);
    });

    it('应该接受 0 次重试', () => {
      const config = {
        apiKey: 'sk-test-key-123',
        maxRetries: 0,
      };

      const result = ProviderConfigSchema.parse(config);
      expect(result.maxRetries).toBe(0);
    });

    it('应该拒绝负数重试次数', () => {
      const config = {
        apiKey: 'sk-test-key-123',
        maxRetries: -1,
      };

      expect(() => ProviderConfigSchema.parse(config)).toThrow();
    });
  });

  describe('请求头配置', () => {
    it('应该接受自定义请求头', () => {
      const config = {
        apiKey: 'sk-test-key-123',
        headers: {
          'X-Custom-Header': 'value',
          'User-Agent': 'custom-agent',
        },
      };

      const result = ProviderConfigSchema.parse(config);
      expect(result.headers).toEqual({
        'X-Custom-Header': 'value',
        'User-Agent': 'custom-agent',
      });
    });

    it('应该允许空请求头', () => {
      const config = {
        apiKey: 'sk-test-key-123',
        headers: {},
      };

      const result = ProviderConfigSchema.parse(config);
      expect(result.headers).toEqual({});
    });
  });

  describe('扩展配置', () => {
    it('应该接受额外的配置字段', () => {
      const config = {
        apiKey: 'sk-test-key-123',
        extra: {
          organization: 'org-123',
          project: 'proj-456',
        },
      };

      const result = ProviderConfigSchema.parse(config);
      expect(result.extra).toEqual({
        organization: 'org-123',
        project: 'proj-456',
      });
    });
  });
});
