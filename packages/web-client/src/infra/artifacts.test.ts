import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpError } from '../gateway/http.js';
import { createArtifactsClient } from './artifacts.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

/**
 * 构造一个带可读流的最小 SSE Response 替身。
 * `chunks` 会按给定顺序逐次 `read()` 返回——调用方借此把一帧切碎，
 * 验证客户端不依赖「帧与 chunk 对齐」。
 */
function sseResponse(chunks: readonly string[]): Response {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          if (index >= chunks.length) {
            return { done: true, value: undefined };
          }
          const chunk = chunks[index] ?? '';
          index += 1;
          return { done: false, value: encoder.encode(chunk) };
        },
        releaseLock: () => undefined,
      }),
    },
  } as unknown as Response;
}

describe('createArtifactsClient', () => {
  it('listForSession 成功时返回 contentArtifacts', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          contentArtifacts: [{ id: 'artifact-1', title: 'Spec' }],
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createArtifactsClient('http://localhost:3000');
    const result = await client.listForSession('token-1', 'session-1');

    expect(result.contentArtifacts?.[0]).toMatchObject({ id: 'artifact-1' });
  });

  it('create 失败时会保留后端 error 文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 409,
        json: async () => ({ error: 'artifact title already exists' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createArtifactsClient('http://localhost:3000');

    await expect(
      client.create('token-1', {
        sessionId: 'session-1',
        title: 'Spec',
        content: 'content',
        type: 'markdown',
      }),
    ).rejects.toThrow('artifact title already exists');
  });

  it('listImageWorkbench 在 403 时会给出权限文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 403,
        json: async () => ({}),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createArtifactsClient('http://localhost:3000');

    await expect(client.listImageWorkbench('token-1')).rejects.toThrow(
      '认证失效或当前账号无权读取图片工作台产物列表。',
    );
  });

  it('generateImage 会优先使用嵌套 error.message', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 500,
        json: async () => ({
          error: { message: 'model backend unavailable' },
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createArtifactsClient('http://localhost:3000');

    try {
      await client.generateImage('token-1', 'session-1', {
        prompt: 'draw a nebula',
        size: '1024x1024',
      });
      throw new Error('expected generateImage to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as Error).message).toContain('model backend unavailable');
    }
  });

  it('update 网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createArtifactsClient('http://localhost:3000');

    await expect(
      client.update('token-1', 'artifact-1', {
        title: 'Spec',
        content: 'next',
      }),
    ).rejects.toThrow('网络异常，更新产物失败。');
  });

  it('remove 会发起 DELETE /artifacts/:id 并接受 204', async () => {
    let calledUrl = '';
    let calledMethod = '';
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input);
      calledMethod = init?.method ?? 'GET';
      return {
        ok: true,
        status: 204,
      } as unknown as Response;
    }) as typeof fetch;

    const client = createArtifactsClient('http://localhost:3000');

    await expect(client.remove('token-1', 'artifact-1')).resolves.toBeUndefined();
    expect(calledUrl).toBe('http://localhost:3000/artifacts/artifact-1');
    expect(calledMethod).toBe('DELETE');
  });

  it('remove 网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createArtifactsClient('http://localhost:3000');

    await expect(client.remove('token-1', 'artifact-1')).rejects.toThrow(
      '网络异常，删除产物失败。',
    );
  });

  it('downloadFromSession 成功时返回二进制 Blob', async () => {
    let calledUrl = '';
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      calledUrl = String(input);
      return {
        ok: true,
        status: 200,
        blob: async () => new Blob([new Uint8Array([1, 2, 3])]),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createArtifactsClient('http://localhost:3000');
    const blob = await client.downloadFromSession('token-1', 'session-1', 'artifact-1');

    expect(calledUrl).toBe('http://localhost:3000/sessions/session-1/artifacts/artifact-1/content');
    expect(blob.size).toBe(3);
  });

  it('downloadFromSession 在 404（副本已被回收）时抛 HttpError', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: '目标产物不存在。' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createArtifactsClient('http://localhost:3000');

    await expect(client.downloadFromSession('token-1', 'session-1', 'gone')).rejects.toBeInstanceOf(
      HttpError,
    );
  });

  it('removeFromSession 会 DELETE 会话下的磁盘型附件并回报 removed', async () => {
    let calledUrl = '';
    let calledMethod = '';
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input);
      calledMethod = init?.method ?? 'GET';
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, removed: true }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createArtifactsClient('http://localhost:3000');

    await expect(client.removeFromSession('token-1', 'session-1', 'artifact-1')).resolves.toBe(
      true,
    );
    expect(calledUrl).toBe('http://localhost:3000/sessions/session-1/artifacts/artifact-1');
    expect(calledMethod).toBe('DELETE');
  });

  it('generateImageStream 按顺序派发 partial / done 事件', async () => {
    let calledUrl = '';
    let calledMethod = '';
    let acceptHeader: string | undefined;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input);
      calledMethod = init?.method ?? 'GET';
      acceptHeader = (init?.headers as Record<string, string> | undefined)?.['Accept'];
      return sseResponse([
        'event: partial\ndata: {"index":0,"mimeType":"image/png","partialImageBase64":"cGFydGlhbA=="}\n\n',
        'event: done\ndata: {"artifact":{"id":"artifact-1"},"artifacts":[{"id":"artifact-1"}]}\n\n',
      ]);
    }) as typeof fetch;

    const client = createArtifactsClient('http://localhost:3000');
    const partials: unknown[] = [];
    const done: unknown[] = [];

    await client.generateImageStream(
      'token-1',
      'session-1',
      { prompt: '画一条羽毛河流', size: '1024x1024' },
      {
        onPartial: (partial) => {
          partials.push(partial);
        },
        onDone: (payload) => {
          done.push(payload);
        },
        onError: () => undefined,
      },
    );

    expect(calledUrl).toBe('http://localhost:3000/sessions/session-1/images/generations/stream');
    expect(calledMethod).toBe('POST');
    expect(acceptHeader).toBe('text/event-stream');
    expect(partials).toEqual([
      { index: 0, mimeType: 'image/png', partialImageBase64: 'cGFydGlhbA==' },
    ]);
    expect(done).toEqual([{ artifact: { id: 'artifact-1' }, artifacts: [{ id: 'artifact-1' }] }]);
  });

  it('generateImageStream 能跨 chunk 边界拼回事件帧', async () => {
    globalThis.fetch = vi.fn(async () => {
      return sseResponse([
        'event: parti',
        'al\ndata: {"index":1,"mimeType":"image/png",',
        '"partialImageBase64":"cA=="}\n\n',
      ]);
    }) as typeof fetch;

    const client = createArtifactsClient('http://localhost:3000');
    const partials: Array<{ index: number }> = [];

    await client.generateImageStream(
      'token-1',
      'session-1',
      { prompt: '画一条羽毛河流', size: '1024x1024' },
      {
        onPartial: (partial) => {
          partials.push(partial as { index: number });
        },
        onDone: () => undefined,
        onError: () => undefined,
      },
    );

    expect(partials).toHaveLength(1);
    expect(partials[0]?.index).toBe(1);
  });

  it('generateImageStream 把 error 事件交给 onError 而不是抛出', async () => {
    globalThis.fetch = vi.fn(async () => {
      return sseResponse([
        'event: error\ndata: {"code":"moderation_blocked","message":"被拦截","retryable":false}\n\n',
      ]);
    }) as typeof fetch;

    const client = createArtifactsClient('http://localhost:3000');
    const errors: Array<{ code?: string }> = [];

    await client.generateImageStream(
      'token-1',
      'session-1',
      { prompt: '画一条羽毛河流', size: '1024x1024' },
      { onDone: () => undefined, onError: (error) => errors.push(error) },
    );

    expect(errors).toEqual([{ code: 'moderation_blocked', message: '被拦截', retryable: false }]);
  });

  it('generateImageStream 对 error 事件里的坏 JSON 给出可识别错误码', async () => {
    globalThis.fetch = vi.fn(async () => {
      return sseResponse(['event: error\ndata: not-json\n\n']);
    }) as typeof fetch;

    const client = createArtifactsClient('http://localhost:3000');
    const errors: Array<{ code?: string }> = [];

    await client.generateImageStream(
      'token-1',
      'session-1',
      { prompt: '画一条羽毛河流', size: '1024x1024' },
      { onDone: () => undefined, onError: (error) => errors.push(error) },
    );

    expect(errors[0]?.code).toBe('stream_invalid_payload');
  });

  it('generateImageStream 在非 2xx 时抛 HttpError 并保留后端文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 400,
        json: async () => ({ error: { message: '当前未配置可用的图片生成模型。' } }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createArtifactsClient('http://localhost:3000');

    await expect(
      client.generateImageStream(
        'token-1',
        'session-1',
        { prompt: '画一条羽毛河流', size: '1024x1024' },
        { onDone: () => undefined, onError: () => undefined },
      ),
    ).rejects.toThrow('当前未配置可用的图片生成模型。');
  });

  it('generateImageStream 在响应没有 body 时明确报错', async () => {
    globalThis.fetch = vi.fn(async () => {
      return { ok: true, status: 200, body: null } as unknown as Response;
    }) as typeof fetch;

    const client = createArtifactsClient('http://localhost:3000');

    await expect(
      client.generateImageStream(
        'token-1',
        'session-1',
        { prompt: '画一条羽毛河流', size: '1024x1024' },
        { onDone: () => undefined, onError: () => undefined },
      ),
    ).rejects.toThrow('图片生成流式响应不可用。');
  });

  it('create 会读取 ApiErrorResponse.data.message', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 400,
        json: async () => ({
          name: 'BadRequest',
          data: { message: '请求体参数无效。', kind: 'Body' },
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createArtifactsClient('http://localhost:3000');

    await expect(
      client.create('token-1', {
        sessionId: 'session-1',
        title: 'Spec',
        content: 'content',
        type: 'markdown',
      }),
    ).rejects.toThrow('请求体参数无效。');
  });
});
