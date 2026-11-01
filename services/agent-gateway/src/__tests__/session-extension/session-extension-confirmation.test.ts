/**
 * 渠道确认链接与回执文案回归。
 *
 * 关键边界：**未配置公开地址时不伪造链接**；文案里不出现任何密钥；明确写出
 * 「群里的同意不构成授权」。
 */
import { describe, expect, it } from 'vitest';
import {
  buildConfirmationUrl,
  buildSessionExtensionConfirmationText,
  buildSessionExtensionResultText,
  resolveConfirmationBaseUrl,
} from '../../session-extension/session-extension-confirmation.js';

describe('resolveConfirmationBaseUrl', () => {
  it('未配置时返回 null（不伪造链接）', () => {
    expect(resolveConfirmationBaseUrl({})).toBeNull();
    expect(resolveConfirmationBaseUrl({ OPENAWORK_PUBLIC_WEB_URL: '   ' })).toBeNull();
  });

  it('拒绝非 http(s) 协议与非 URL', () => {
    expect(
      resolveConfirmationBaseUrl({ OPENAWORK_PUBLIC_WEB_URL: 'javascript:alert(1)' }),
    ).toBeNull();
    expect(resolveConfirmationBaseUrl({ OPENAWORK_PUBLIC_WEB_URL: 'not-a-url' })).toBeNull();
  });

  it('保留路径前缀并去掉尾斜杠', () => {
    expect(
      resolveConfirmationBaseUrl({ OPENAWORK_PUBLIC_WEB_URL: 'https://example.com/app/' }),
    ).toBe('https://example.com/app');
  });
});

describe('buildConfirmationUrl', () => {
  it('携带会话与操作，且不包含任何密钥', () => {
    const url = buildConfirmationUrl({
      baseUrl: 'https://example.com',
      sessionId: 's-1',
      operationId: 'opx_1',
    });
    expect(url).toContain('session=s-1');
    expect(url).toContain('operation=opx_1');
    expect(url).not.toContain('token');
  });
});

describe('buildSessionExtensionConfirmationText', () => {
  const base = {
    operationId: 'opx_1',
    kind: 'skill' as const,
    targetLabel: 'demo-skill',
    expiresAt: Date.UTC(2026, 9, 31, 12, 0, 0),
    warnings: ['该技能内嵌 MCP：安装后会以当前会话身份连接该服务。'],
  };

  it('说明仅会话范围、生效时机与有效期，并给出确认链接', () => {
    const text = buildSessionExtensionConfirmationText({
      sessionId: 's-1',
      input: base,
      baseUrl: 'https://example.com',
    });
    expect(text).toContain('仅当前会话');
    expect(text).toContain('下一轮对话');
    expect(text).toContain('待确认');
    expect(text).toContain('https://example.com/session-extensions/confirm');
    expect(text).toContain('内嵌 MCP');
    expect(text).toContain('群里的「同意」不构成授权');
  });

  it('未配置公开地址时降级为面板指引，且不出现半截链接', () => {
    const text = buildSessionExtensionConfirmationText({
      sessionId: 's-1',
      input: base,
      baseUrl: null,
    });
    expect(text).toContain('OPENAWORK_PUBLIC_WEB_URL');
    expect(text).toContain('会话扩展');
    expect(text).not.toContain('confirm?');
  });
});

describe('buildSessionExtensionResultText', () => {
  it('成功与不可用必须区分，不能把探活失败说成成功', () => {
    expect(
      buildSessionExtensionResultText({
        kind: 'mcp',
        targetLabel: 'local',
        status: 'succeeded',
      }),
    ).toContain('✅');

    const unavailable = buildSessionExtensionResultText({
      kind: 'mcp',
      targetLabel: 'local',
      status: 'configured_unavailable',
      errorMessage: 'connect ECONNREFUSED',
    });
    expect(unavailable).toContain('不可用');
    expect(unavailable).toContain('ECONNREFUSED');
  });

  it('拒绝 / 过期 / 取消都明确说明「未做任何变更」', () => {
    for (const status of ['rejected', 'expired', 'cancelled'] as const) {
      const text = buildSessionExtensionResultText({
        kind: 'skill',
        targetLabel: 'demo',
        status,
      });
      expect(text).toContain('未做任何变更');
    }
  });
});
