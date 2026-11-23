import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPromptOverridesClient } from './prompt-overrides.js';
// 注意：`session/sessions.ts` 与 `gateway/http.ts` 各有一个同名 `HttpError` 类（仓库既有双定义）。
// 本客户端与 `session/agents.ts` 同源，抛的是 `gateway/http.ts` 的那个，断言必须用同一引用。
import { HttpError } from '../gateway/http.js';

const originalFetch = globalThis.fetch;

function mockJsonOnce(payload: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
    } as unknown as Response;
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createPromptOverridesClient', () => {
  it('read 解析快照，过滤非法模式并透出 corrupt 状态', async () => {
    mockJsonOnce({
      modes: [
        { mode: 'coding', defaultText: 'D', effectiveText: 'E', hasOverride: true },
        { mode: 'bogus', defaultText: 'x' },
      ],
      maxChars: 32768,
      configState: 'corrupt',
    });

    const client = createPromptOverridesClient('http://localhost:3000');
    const snapshot = await client.read('token-1');

    expect(snapshot.maxChars).toBe(32768);
    expect(snapshot.configState).toBe('corrupt');
    expect(snapshot.modes).toHaveLength(1);
    expect(snapshot.modes[0]).toEqual({
      mode: 'coding',
      defaultText: 'D',
      effectiveText: 'E',
      hasOverride: true,
    });
  });

  it('effectiveText 缺失时回落到 defaultText，缺字段不抛错', async () => {
    mockJsonOnce({ modes: [{ mode: 'clarify', defaultText: 'D' }] });

    const client = createPromptOverridesClient('http://localhost:3000');
    const snapshot = await client.read('token-1');

    expect(snapshot.configState).toBe('ok');
    expect(snapshot.maxChars).toBe(0);
    expect(snapshot.modes[0]).toEqual({
      mode: 'clarify',
      defaultText: 'D',
      effectiveText: 'D',
      hasOverride: false,
    });
  });

  it('writeDialogueMode 发送 PUT 到模式路由并回传视图（保留原始空白）', async () => {
    const fetchMock = mockJsonOnce({
      promptOverride: {
        mode: 'coding',
        defaultText: 'D',
        effectiveText: '  T  ',
        hasOverride: true,
      },
    });

    const client = createPromptOverridesClient('http://localhost:3000');
    const view = await client.writeDialogueMode('token-1', 'coding', '  T  ');

    expect(view.effectiveText).toBe('  T  ');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:3000/prompt-overrides/dialogue-modes/coding');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(JSON.stringify({ text: '  T  ' }));
  });

  it('writeDialogueMode 保留后端错误文案与状态码', async () => {
    mockJsonOnce({ error: '提示词不能为空。' }, 400);

    const client = createPromptOverridesClient('http://localhost:3000');

    try {
      await client.writeDialogueMode('token-1', 'coding', '   ');
      throw new Error('expected writeDialogueMode to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(400);
      expect((error as Error).message).toBe('提示词不能为空。');
    }
  });

  it('writeDialogueMode 在响应缺少 promptOverride 时抛格式异常', async () => {
    mockJsonOnce({});

    const client = createPromptOverridesClient('http://localhost:3000');

    await expect(client.writeDialogueMode('token-1', 'coding', 'T')).rejects.toThrow('格式异常');
  });

  it('resetDialogueMode 发送 POST 并回传默认视图', async () => {
    const fetchMock = mockJsonOnce({
      promptOverride: {
        mode: 'programmer',
        defaultText: 'D',
        effectiveText: 'D',
        hasOverride: false,
      },
    });

    const client = createPromptOverridesClient('http://localhost:3000');
    const view = await client.resetDialogueMode('token-1', 'programmer');

    expect(view.hasOverride).toBe(false);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:3000/prompt-overrides/dialogue-modes/programmer/reset');
    expect(init.method).toBe('POST');
  });

  it('网络异常转换为中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as unknown as typeof fetch;

    const client = createPromptOverridesClient('http://localhost:3000');

    await expect(client.writeDialogueMode('token-1', 'coding', 'T')).rejects.toThrow(
      '网络异常，保存模式提示词失败。',
    );
  });
});
