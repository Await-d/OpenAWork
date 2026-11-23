/**
 * 注册源鉴权与取回地址（261101）。
 *
 * 这层是「会话技能安装」唯一的对外 I/O：`SkillRegistryClientImpl.getDetail()` →
 * `fetchSkillDetailFromSource()`。两条不变量必须有直接断言，否则只能靠端到端间接推断：
 *
 *   1. **取回地址与 `source.type` 无关**——所有类型都走
 *      `${source.url}/skills/<id>.json`。包里另有 `LocalInstaller.installFromLocalDir`
 *      （读本地 `${dir}/skill.yaml`），但它在 `install()` 路径上**不会被调用**；
 *      如果哪天有人按类型分派取回，这条用例会先失败。
 *   2. **鉴权只有 `buildHeaders` 一个分支**，三种形态都不能漏发或错发——
 *      凭据发到错误的头里，等于把 token 交给了一个不认识的端点。
 *
 * 用桩 fetch 而不是起 HTTP 服务：要断言的是**请求头本身**，不是服务端行为。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SkillRegistryClientImpl } from './client.js';
import { RegistrySourceManager } from './source.js';
import type { RegistryAuth, RegistrySource, RegistrySourceType } from './types.js';

const OriginalFetch = globalThis.fetch;

function source(
  auth: RegistryAuth | undefined,
  overrides: Partial<RegistrySource> = {},
): RegistrySource {
  return {
    id: 'test-source',
    name: 'Test',
    url: 'https://registry.test',
    type: 'community',
    trust: 'verified',
    enabled: true,
    priority: 1,
    ...(auth === undefined ? {} : { auth }),
    ...overrides,
  };
}

/** 桩 fetch：记录 url 与 init，返回一条最小可用条目。 */
function captureFetch(): { calls: Array<{ url: string; headers: unknown }> } {
  const calls: Array<{ url: string; headers: unknown }> = [];
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    calls.push({ url: String(url), headers: init?.headers });
    return Promise.resolve(
      new Response(JSON.stringify({ id: 'demo', name: 'demo', version: '1.0.0' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }) as typeof fetch;
  return { calls };
}

afterEach(() => {
  globalThis.fetch = OriginalFetch;
  vi.restoreAllMocks();
});

describe('注册源取回地址', () => {
  it.each(['official', 'community', 'enterprise', 'local'] as RegistrySourceType[])(
    'type=%s 共用同一条 HTTP 取回路径',
    async (type) => {
      const { calls } = captureFetch();
      const manager = new RegistrySourceManager([source({ type: 'none' }, { type })]);
      await new SkillRegistryClientImpl(manager).getDetail('demo', 'test-source');

      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe('https://registry.test/skills/demo.json');
    },
  );

  it('末尾斜杠不会造成双斜杠', async () => {
    const { calls } = captureFetch();
    const manager = new RegistrySourceManager([
      source({ type: 'none' }, { url: 'https://registry.test/' }),
    ]);
    await new SkillRegistryClientImpl(manager).getDetail('demo', 'test-source');
    expect(calls[0]?.url).toBe('https://registry.test/skills/demo.json');
  });
});

describe('注册源鉴权', () => {
  it('未配置鉴权时不带任何凭据头', async () => {
    const { calls } = captureFetch();
    const manager = new RegistrySourceManager([source(undefined)]);
    await new SkillRegistryClientImpl(manager).getDetail('demo', 'test-source');
    expect(calls[0]?.headers).toEqual({});
  });

  it('type=none 同样不带凭据头', async () => {
    const { calls } = captureFetch();
    const manager = new RegistrySourceManager([source({ type: 'none' })]);
    await new SkillRegistryClientImpl(manager).getDetail('demo', 'test-source');
    expect(calls[0]?.headers).toEqual({});
  });

  it('bearer 拼成 Authorization: Bearer <token>', async () => {
    const { calls } = captureFetch();
    const manager = new RegistrySourceManager([source({ type: 'bearer', token: 'tok-123' })]);
    await new SkillRegistryClientImpl(manager).getDetail('demo', 'test-source');
    expect(calls[0]?.headers).toEqual({ Authorization: 'Bearer tok-123' });
  });

  it('api-key 用自定义头名，不能落到 Authorization 上', async () => {
    const { calls } = captureFetch();
    const manager = new RegistrySourceManager([
      source({ type: 'api-key', header: 'x-registry-key', value: 'key-456' }),
    ]);
    await new SkillRegistryClientImpl(manager).getDetail('demo', 'test-source');
    expect(calls[0]?.headers).toEqual({ 'x-registry-key': 'key-456' });
    expect(JSON.stringify(calls[0]?.headers)).not.toContain('Authorization');
  });
});

describe('注册源取回失败', () => {
  it('非 2xx 返回 undefined 而不是抛错，让上层按「源里没有」处理', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(new Response('nope', { status: 403 }))) as typeof fetch;
    const manager = new RegistrySourceManager([source({ type: 'none' })]);
    await expect(
      new SkillRegistryClientImpl(manager).getDetail('demo', 'test-source'),
    ).resolves.toBeUndefined();
  });
});
