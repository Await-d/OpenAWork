import { describe, expect, it } from 'vitest';
import { redactSecrets, redactUrl, urlCarriesSecret } from './devtools-redact.js';

describe('redactSecrets', () => {
  it('按密钥名打码任意深度的字符串值', () => {
    const redacted = redactSecrets({
      providers: {
        example: {
          settings: { apiKey: 'sk-example', timeout: 1200 },
          oauth: { client_secret: 'oauth-secret', client_id: 'public' },
        },
      },
    });

    expect(redacted).toEqual({
      providers: {
        example: {
          settings: { apiKey: '***', timeout: 1200 },
          oauth: { client_secret: '***', client_id: 'public' },
        },
      },
    });
  });

  it('headers 子树下所有字符串值一律打码', () => {
    const redacted = redactSecrets({
      headers: { Authorization: 'Bearer example', 'X-Custom': 'opaque' },
      request: { headers: { 'x-auth-token': 'model-secret' } },
      model: 'gpt-5',
    });

    expect(redacted).toEqual({
      headers: { Authorization: '***', 'X-Custom': '***' },
      request: { headers: { 'x-auth-token': '***' } },
      model: 'gpt-5',
    });
  });

  it('保留非敏感值：数字、布尔、普通字符串与普通 URL', () => {
    const redacted = redactSecrets({
      timeout: 1200,
      enabled: true,
      name: 'demo',
      endpoint: 'https://api.example.com/v1',
    });

    expect(redacted).toEqual({
      timeout: 1200,
      enabled: true,
      name: 'demo',
      endpoint: 'https://api.example.com/v1',
    });
  });

  it('携带 userinfo 或密钥名查询参数的 URL 整体打码', () => {
    const redacted = redactSecrets({
      basic: 'https://user:pass@example.com/v1',
      query: 'https://example.com/v1?api_key=abc',
      plain: 'https://example.com/v1',
      text: 'not-a-url',
    });

    expect(redacted).toEqual({
      basic: '***',
      query: '***',
      plain: 'https://example.com/v1',
      text: 'not-a-url',
    });
  });

  it('数组内的对象同样被脱敏', () => {
    expect(redactSecrets([{ token: 't' }, { model: 'gpt' }])).toEqual([
      { token: '***' },
      { model: 'gpt' },
    ]);
  });

  it('非对象载荷原样返回', () => {
    expect(redactSecrets('plain')).toBe('plain');
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets(undefined)).toBeUndefined();
  });
});

describe('urlCarriesSecret / redactUrl', () => {
  it('识别 userinfo 与密钥名查询参数', () => {
    expect(urlCarriesSecret('https://a:b@host/v1')).toBe(true);
    expect(urlCarriesSecret('https://host/v1?token=x')).toBe(true);
    expect(urlCarriesSecret('https://host/v1?page=2')).toBe(false);
    expect(urlCarriesSecret('https://host/v1')).toBe(false);
    expect(urlCarriesSecret('ftp://host/v1')).toBe(false);
  });

  it('无法解析的 http URL 按敏感处理', () => {
    expect(redactUrl('https://exa mple.com/v1')).toBe('***');
    expect(redactUrl('http://localhost:3000')).toBe('http://localhost:3000');
  });
});
