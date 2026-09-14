import { describe, expect, it } from 'vitest';
import {
  OPENCODE_SESSION_HEADER,
  opencodeSessionAffinityValue,
  withOpencodeSessionHeader,
} from '../../v2-runtime/upstream/session-affinity.js';
import { OPENCODE_GO_BASE_URL } from '../../provider/opencode-go.js';

describe('withOpencodeSessionHeader', () => {
  it('为 OpenCode Go 域名补上会话亲和头', () => {
    const result = withOpencodeSessionHeader(undefined, {
      baseUrl: 'https://opencode.ai/zen/go/v1',
      sessionId: 'session-123',
    });

    expect(result?.[OPENCODE_SESSION_HEADER]).toBeDefined();
    expect(result?.[OPENCODE_SESSION_HEADER]).toHaveLength(32);
  });

  it('识别内置 opencode-go 平台类型(即便未给 baseUrl)', () => {
    const result = withOpencodeSessionHeader(undefined, {
      providerType: 'opencode-go',
      sessionId: 'session-123',
    });

    expect(result?.[OPENCODE_SESSION_HEADER]).toBeDefined();
  });

  it('大小写/空格归一后仍能识别平台类型', () => {
    const result = withOpencodeSessionHeader(undefined, {
      providerType: ' OpenCode-Go ',
      sessionId: 'session-123',
    });

    expect(result?.[OPENCODE_SESSION_HEADER]).toBeDefined();
  });

  it('对非 OpenCode 上游不注入且保持原对象', () => {
    const headers = { authorization: 'Bearer x' };
    const result = withOpencodeSessionHeader(headers, {
      baseUrl: 'https://api.openai.com/v1',
      sessionId: 'session-123',
    });

    expect(result).toBe(headers);
    expect(result?.[OPENCODE_SESSION_HEADER]).toBeUndefined();
  });

  it('对无法解析的 baseUrl 不注入', () => {
    const result = withOpencodeSessionHeader(undefined, {
      baseUrl: 'not a url',
      sessionId: 'session-123',
    });

    expect(result).toBeUndefined();
  });

  it('缺少 sessionId 时不注入(不退化成随机值)', () => {
    const headers = { authorization: 'Bearer x' };
    const result = withOpencodeSessionHeader(headers, {
      baseUrl: OPENCODE_GO_BASE_URL,
    });

    expect(result).toBe(headers);
    expect(result?.[OPENCODE_SESSION_HEADER]).toBeUndefined();
  });

  it('保留既有 headers 并追加亲和头', () => {
    const result = withOpencodeSessionHeader(
      { 'x-title': 'OpenAWork' },
      {
        baseUrl: OPENCODE_GO_BASE_URL,
        sessionId: 'session-123',
      },
    );

    expect(result?.['x-title']).toBe('OpenAWork');
    expect(result?.[OPENCODE_SESSION_HEADER]).toBeDefined();
  });

  it('不覆盖调用方显式提供的大小写不敏感 session 头', () => {
    const headers = { 'X-OpenCode-Session': 'caller-session' };
    const result = withOpencodeSessionHeader(headers, {
      baseUrl: 'https://opencode.ai/zen/go/v1',
      sessionId: 'generated-session',
    });

    expect(result).toBe(headers);
    expect(result?.[OPENCODE_SESSION_HEADER]).toBeUndefined();
  });
});

describe('opencodeSessionAffinityValue', () => {
  it('同一会话稳定，不同会话不同', () => {
    const a = opencodeSessionAffinityValue('session-a');
    const b = opencodeSessionAffinityValue('session-a');
    const c = opencodeSessionAffinityValue('session-b');

    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('不泄漏原始会话 ID', () => {
    expect(opencodeSessionAffinityValue('session-a')).not.toContain('session-a');
  });

  it('空白会话 ID 视为缺失', () => {
    expect(opencodeSessionAffinityValue(undefined)).toBeUndefined();
    expect(opencodeSessionAffinityValue('   ')).toBeUndefined();
  });
});
