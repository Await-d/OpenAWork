import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateImageWithOpenAi } from '../image-generation/openai-image-generation.js';

describe('generateImageWithOpenAi', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('does not attach an implicit timeout signal to image generation requests', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ b64_json: Buffer.from('image-bytes').toString('base64') }],
        }),
        { status: 200 },
      ),
    );

    await generateImageWithOpenAi({
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-openai',
      background: 'auto',
      model: 'gpt-image-2',
      outputFormat: 'png',
      prompt: '画一张蓝鲸海报',
      providerType: 'openai',
      quality: 'high',
      requestOverrides: {},
      size: '3840x2160',
    });

    const fetchInit = vi.mocked(globalThis.fetch).mock.calls[0]?.[1];
    expect(fetchInit?.signal).toBeUndefined();
  });

  it('keeps caller-driven cancellation available without converting it to a timeout', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    vi.mocked(globalThis.fetch).mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    );

    const pending = generateImageWithOpenAi({
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-openai',
      background: 'auto',
      model: 'gpt-image-2',
      outputFormat: 'png',
      prompt: '画一张 4K 蓝鲸海报',
      providerType: 'openai',
      quality: 'high',
      requestOverrides: {},
      signal: controller.signal,
      size: '3840x2160',
    });
    let settled = false;
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await vi.advanceTimersByTimeAsync(360_000);
    expect(settled).toBe(false);

    controller.abort();
    const assertion = expect(pending).rejects.toMatchObject({
      statusCode: 499,
      retryable: false,
      message: '图片生成已被取消。',
    });

    await assertion;
  });
});
