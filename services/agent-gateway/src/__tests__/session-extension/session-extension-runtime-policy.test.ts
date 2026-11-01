/**
 * 会话级 MCP 运行时风险策略回归（T-10）。
 *
 * 锁定三条默认收紧：stdio 需显式开关、会话内拒绝 OAuth、secretRef 必须属于本会话；
 * 并锁定「最小环境不继承网关凭据」。
 */
import { describe, expect, it } from 'vitest';
import {
  parseSessionSecretRefName,
  sessionMcpConfigSchema,
  SESSION_EXTENSION_ALLOW_STDIO_ENV,
  buildMinimalStdioEnvironment,
  buildSessionSecretRef,
  isSessionExtensionStdioAllowed,
  isSessionSecretRefOwnedBySession,
  resolveSessionMcpRuntimePolicyDenial,
} from '../../session-extension/session-extension-runtime-policy.js';

const SESSION = 's-policy';

describe('会话配置拒绝含密字段', () => {
  it.each([
    'https://user:secret@example.com/mcp',
    'https://example.com/mcp?token=secret',
    'https://example.com/mcp#secret',
    'file:///tmp/mcp',
  ])('拒绝端点 %s', (url) => {
    expect(
      sessionMcpConfigSchema.safeParse({ id: 'x', name: 'x', transport: 'sse', url }).success,
    ).toBe(false);
  });
  it('拒绝未知嵌套配置和凭据命令参数', () => {
    expect(
      sessionMcpConfigSchema.safeParse({
        id: 'x',
        name: 'x',
        transport: 'sse',
        url: 'https://example.com',
        nested: { token: 'secret' },
      }).success,
    ).toBe(false);
    expect(
      sessionMcpConfigSchema.safeParse({
        id: 'x',
        name: 'x',
        transport: 'stdio',
        command: 'node',
        args: ['--token', 'secret'],
      }).success,
    ).toBe(false);
  });
});

describe('stdio 开关', () => {
  it('缺省 / 假值一律关闭', () => {
    expect(isSessionExtensionStdioAllowed({})).toBe(false);
    expect(isSessionExtensionStdioAllowed({ [SESSION_EXTENSION_ALLOW_STDIO_ENV]: '' })).toBe(false);
    expect(isSessionExtensionStdioAllowed({ [SESSION_EXTENSION_ALLOW_STDIO_ENV]: 'false' })).toBe(
      false,
    );
    expect(isSessionExtensionStdioAllowed({ [SESSION_EXTENSION_ALLOW_STDIO_ENV]: '0' })).toBe(
      false,
    );
  });

  it('显式真值才放行', () => {
    for (const value of ['1', 'true', 'TRUE', 'yes', 'on']) {
      expect(isSessionExtensionStdioAllowed({ [SESSION_EXTENSION_ALLOW_STDIO_ENV]: value })).toBe(
        true,
      );
    }
  });

  it('stdio 提案在开关关闭时被拒绝，且提示如何开启', () => {
    const denial = resolveSessionMcpRuntimePolicyDenial({
      config: { transport: 'stdio' },
      secretRef: null,
      sessionId: SESSION,
      env: {},
    });
    expect(denial).toContain('stdio');
    expect(denial).toContain(SESSION_EXTENSION_ALLOW_STDIO_ENV);
  });

  it('开启后 stdio 提案放行', () => {
    expect(
      resolveSessionMcpRuntimePolicyDenial({
        config: { transport: 'stdio' },
        secretRef: null,
        sessionId: SESSION,
        env: { [SESSION_EXTENSION_ALLOW_STDIO_ENV]: '1' },
      }),
    ).toBeNull();
  });

  it('sse 不受 stdio 开关影响', () => {
    expect(
      resolveSessionMcpRuntimePolicyDenial({
        config: { transport: 'sse' },
        secretRef: null,
        sessionId: SESSION,
        env: {},
      }),
    ).toBeNull();
  });
});

describe('会话内 OAuth', () => {
  it('带 OAuth 配置的提案被拒绝并指向设置页', () => {
    const denial = resolveSessionMcpRuntimePolicyDenial({
      config: { transport: 'sse', oauth: { clientId: 'x' } },
      secretRef: null,
      sessionId: SESSION,
    });
    expect(denial).toContain('OAuth');
    expect(denial).toContain('设置页');
  });

  it('oauth: false 与未声明都放行', () => {
    expect(
      resolveSessionMcpRuntimePolicyDenial({
        config: { transport: 'sse', oauth: false },
        secretRef: null,
        sessionId: SESSION,
      }),
    ).toBeNull();
    expect(
      resolveSessionMcpRuntimePolicyDenial({
        config: { transport: 'sse' },
        secretRef: null,
        sessionId: SESSION,
      }),
    ).toBeNull();
  });
});

describe('secretRef 归属', () => {
  it('本会话引用解析出名称，但仍要求声明注入点', () => {
    const ref = buildSessionSecretRef(SESSION, 'api-key');
    expect(isSessionSecretRefOwnedBySession({ secretRef: ref, sessionId: SESSION })).toBe(true);
    expect(parseSessionSecretRefName({ secretRef: ref, sessionId: SESSION })).toBe('api-key');
    // 只有引用、没有注入点：不知道该塞到哪个 header / 环境变量，必须拒绝（猜错就是把
    // 密钥发到错误的地方）。这一步纯逻辑，不查库。
    expect(
      resolveSessionMcpRuntimePolicyDenial({
        config: { transport: 'sse' },
        secretRef: ref,
        sessionId: SESSION,
      }),
    ).toContain('secretBinding');
  });

  it('跨会话 / 无命名空间 / 空名称的引用一律拒绝', () => {
    expect(
      isSessionSecretRefOwnedBySession({ secretRef: 'session:other:key', sessionId: SESSION }),
    ).toBe(false);
    expect(isSessionSecretRefOwnedBySession({ secretRef: 'global:key', sessionId: SESSION })).toBe(
      false,
    );
    expect(
      isSessionSecretRefOwnedBySession({ secretRef: `session:${SESSION}:`, sessionId: SESSION }),
    ).toBe(false);
    expect(
      isSessionSecretRefOwnedBySession({ secretRef: 'session::key', sessionId: SESSION }),
    ).toBe(false);

    const denial = resolveSessionMcpRuntimePolicyDenial({
      config: { transport: 'sse' },
      secretRef: 'session:other:key',
      sessionId: SESSION,
    });
    expect(denial).toContain('secretRef');
  });
});

describe('最小 stdio 环境', () => {
  it('保留 PATH / HOME，剥离网关凭据类变量', () => {
    const env = buildMinimalStdioEnvironment({
      baseEnv: {
        PATH: '/usr/bin',
        HOME: '/home/u',
        LANG: 'zh_CN.UTF-8',
        AI_API_KEY: 'secret',
        OPENAI_API_KEY: 'secret',
        GITHUB_TOKEN: 'secret',
        JWT_SECRET: 'secret',
        AWS_SECRET_ACCESS_KEY: 'secret',
        RANDOM_UNRELATED: 'x',
      },
    });
    expect(env['PATH']).toBe('/usr/bin');
    expect(env['HOME']).toBe('/home/u');
    expect(env['LANG']).toBe('zh_CN.UTF-8');
    expect(env['AI_API_KEY']).toBeUndefined();
    expect(env['OPENAI_API_KEY']).toBeUndefined();
    expect(env['GITHUB_TOKEN']).toBeUndefined();
    expect(env['JWT_SECRET']).toBeUndefined();
    expect(env['AWS_SECRET_ACCESS_KEY']).toBeUndefined();
    expect(env['RANDOM_UNRELATED']).toBeUndefined();
  });

  it('显式声明的变量会被合入（用户明确要求）', () => {
    const env = buildMinimalStdioEnvironment({
      baseEnv: { PATH: '/usr/bin', AI_API_KEY: 'gateway-secret' },
      explicit: { MY_SERVER_TOKEN: 'user-provided' },
    });
    expect(env['MY_SERVER_TOKEN']).toBe('user-provided');
    // 即便显式声明，也不代表会捎带网关自己的凭据。
    expect(env['AI_API_KEY']).toBeUndefined();
  });
});
