import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webfetchTool } from '../../tools/web-tools.js';

const NO_SIGNAL = new AbortController().signal;

/**
 * 回归背景：旧实现在 `!response.ok` 时直接丢弃 body、只抛状态码，模型因此
 * 无法区分「仓库不存在」「raw.githubusercontent 文件名大小写写错」和
 * 「触发 GitHub API 限流」，只能对同一个错误 URL 反复重试。
 */
function fetchErrorOf(promise: Promise<unknown>): Promise<Error> {
  return promise.then(
    () => {
      throw new Error('expected webfetch to reject');
    },
    (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
  );
}

describe('webfetch 失败诊断信息', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('403 时回灌限流响应头与正文，并给出 UA / token 排查建议', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('{"message":"API rate limit exceeded for 203.0.113.5"}', {
        status: 403,
        statusText: 'Forbidden',
        headers: {
          'content-type': 'application/json',
          'x-ratelimit-limit': '60',
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': '1760000000',
        },
      }),
    );

    const error = await fetchErrorOf(
      webfetchTool.execute(
        { url: 'https://api.github.com/repos/openai/codex', format: 'text', timeout: 20 },
        NO_SIGNAL,
      ),
    );

    expect(error.message).toContain('webfetch request failed with status 403');
    expect(error.message).toContain('x-ratelimit-remaining=0');
    expect(error.message).toContain('x-ratelimit-limit=60');
    expect(error.message).toContain('API rate limit exceeded');
    expect(error.message).toContain('GITHUB_TOKEN');
  });

  it('404 时回灌正文并点明 raw.githubusercontent 大小写敏感', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('{"message":"Not Found"}', {
        status: 404,
        statusText: 'Not Found',
        headers: { 'content-type': 'application/json' },
      }),
    );

    const error = await fetchErrorOf(
      webfetchTool.execute(
        {
          url: 'https://raw.githubusercontent.com/awesome-jellyfin/awesome-jellyfin/main/readme.md',
          format: 'text',
          timeout: 20,
        },
        NO_SIGNAL,
      ),
    );

    expect(error.message).toContain('webfetch request failed with status 404');
    expect(error.message).toContain('Not Found');
    expect(error.message).toContain('README.md');
  });

  it('HTML 拦截页会被清洗为可读文本而非整页标签', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        '<html><head><style>.x{color:red}</style></head><body><h1>Blocked</h1><p>Too Many Requests</p></body></html>',
        { status: 429, headers: { 'content-type': 'text/html; charset=utf-8' } },
      ),
    );

    const error = await fetchErrorOf(
      webfetchTool.execute(
        { url: 'https://www.reddit.com/r/test/', format: 'text', timeout: 20 },
        NO_SIGNAL,
      ),
    );

    expect(error.message).toContain('status 429');
    expect(error.message).toContain('Blocked');
    expect(error.message).not.toContain('<html>');
    expect(error.message).not.toContain('<style>');
  });

  it('空正文时明确标注而非留白', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('', { status: 502, headers: { 'content-type': 'text/plain' } }),
    );

    const error = await fetchErrorOf(
      webfetchTool.execute(
        { url: 'https://example.com/x', format: 'text', timeout: 20 },
        NO_SIGNAL,
      ),
    );

    expect(error.message).toContain('status 502');
    expect(error.message).toContain('<空正文>');
  });
});

describe('webfetch 请求头注入', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function headersOf(callIndex: number): Headers {
    const init = vi.mocked(globalThis.fetch).mock.calls[callIndex]?.[1];
    return new Headers(init?.headers);
  }

  it('inputSchema 保持 ZodObject，避免工具 schema 发给模型时退化成 string', () => {
    // 防回归：zod v3 下给 object 挂 .superRefine() 会变成 ZodEffects，
    // 而 tool-adapter 的 zodToJsonSchema 无该分支 → 模型看不到任何参数名。
    const def = (webfetchTool.inputSchema as { _def?: { typeName?: string } })._def;
    expect(def?.typeName).toBe('ZodObject');
  });

  it('未配置 GITHUB_TOKEN 时不注入认证头，保持既有零行为变更', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } }),
    );

    await webfetchTool.execute(
      { url: 'https://api.github.com/repos/a/b', format: 'text', timeout: 20 },
      NO_SIGNAL,
    );

    expect(headersOf(0).get('authorization')).toBeNull();
  });

  it('配置 GITHUB_TOKEN 后对 api.github.com 自动注入 Bearer 认证头', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'ghp_test_token_value');
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } }),
    );

    await webfetchTool.execute(
      { url: 'https://api.github.com/repos/a/b', format: 'text', timeout: 20 },
      NO_SIGNAL,
    );

    expect(headersOf(0).get('authorization')).toBe('Bearer ghp_test_token_value');
    expect(headersOf(0).get('x-github-api-version')).toBe('2022-11-28');
  });

  it('GH_TOKEN 作为等价来源同样生效', async () => {
    vi.stubEnv('GH_TOKEN', 'ghp_from_gh_token');
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } }),
    );

    await webfetchTool.execute(
      { url: 'https://api.github.com/repos/a/b', format: 'text', timeout: 20 },
      NO_SIGNAL,
    );

    expect(headersOf(0).get('authorization')).toBe('Bearer ghp_from_gh_token');
  });

  it('非 GitHub 主机即使配置了 token 也不注入', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'ghp_test_token_value');
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } }),
    );

    await webfetchTool.execute(
      { url: 'https://example.com/data', format: 'text', timeout: 20 },
      NO_SIGNAL,
    );

    expect(headersOf(0).get('authorization')).toBeNull();
  });

  it('空白 token 视为未配置，不注入空 Bearer 头', async () => {
    vi.stubEnv('GITHUB_TOKEN', '   ');
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } }),
    );

    await webfetchTool.execute(
      { url: 'https://api.github.com/repos/a/b', format: 'text', timeout: 20 },
      NO_SIGNAL,
    );

    expect(headersOf(0).get('authorization')).toBeNull();
  });
});
