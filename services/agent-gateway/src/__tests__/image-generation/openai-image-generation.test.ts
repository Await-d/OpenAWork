import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  editImageWithOpenAi,
  generateImageStreamWithOpenAi,
  generateImageWithOpenAi,
  generateImagesWithOpenAi,
} from '../../image-generation/openai-image-generation.js';

const b64 = (value: string) => Buffer.from(value).toString('base64');

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** 把 SSE 文本按任意偏移切开，验证解析器不依赖「帧与 chunk 对齐」。 */
function chunkify(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks;
}

function stubStreamingResponse(chunks: string[]): void {
  const encoder = new TextEncoder();
  vi.mocked(globalThis.fetch).mockResolvedValue(
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      }),
      { status: 200 },
    ),
  );
}

const STREAM_INPUT = {
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-openai',
  background: 'auto',
  model: 'gpt-image-2.5-flare',
  moderation: 'auto',
  outputFormat: 'png',
  prompt: '画一条羽毛河流',
  providerType: 'openai',
  quality: 'high',
  requestOverrides: {},
  size: '1024x1024',
} as const;

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
      moderation: 'auto',
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
      moderation: 'auto',
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

  it('applies request body overrides to image edit multipart requests', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ b64_json: Buffer.from('edited-image').toString('base64') }],
        }),
        { status: 200 },
      ),
    );

    await editImageWithOpenAi({
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-openai',
      background: 'auto',
      inputImage: {
        bytes: Buffer.from('input-image'),
        fileName: 'input.png',
        mimeType: 'image/png',
      },
      model: 'gpt-image-2',
      moderation: 'low',
      outputFormat: 'png',
      prompt: '把图改成海报风格',
      providerType: 'openai',
      quality: 'medium',
      requestOverrides: {
        body: {
          user: 'user-1',
        },
      },
      size: '1024x1024',
    });

    const fetchInit = vi.mocked(globalThis.fetch).mock.calls[0]?.[1];
    expect(fetchInit?.body).toBeInstanceOf(FormData);
    const form = fetchInit?.body as FormData;
    expect(form.get('model')).toBe('gpt-image-2');
    expect(form.get('moderation')).toBe('low');
    expect(form.get('user')).toBe('user-1');
    expect(form.get('image')).toBeInstanceOf(File);
  });

  it('allows request overrides to omit multipart edit fields', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ b64_json: Buffer.from('edited-image').toString('base64') }],
        }),
        { status: 200 },
      ),
    );

    await editImageWithOpenAi({
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-openai',
      background: 'auto',
      inputImage: {
        bytes: Buffer.from('input-image'),
        fileName: 'input.png',
        mimeType: 'image/png',
      },
      model: 'gpt-image-2',
      moderation: 'auto',
      outputFormat: 'png',
      prompt: '把图改成极简风格',
      providerType: 'openai',
      quality: 'medium',
      requestOverrides: {
        omitBodyKeys: ['background', 'image'],
      },
      size: '1024x1024',
    });

    const fetchInit = vi.mocked(globalThis.fetch).mock.calls[0]?.[1];
    expect(fetchInit?.body).toBeInstanceOf(FormData);
    const form = fetchInit?.body as FormData;
    expect(form.has('background')).toBe(false);
    expect(form.has('image')).toBe(false);
    expect(form.get('prompt')).toBe('把图改成极简风格');
  });

  it('bounds an oversized upstream response body instead of buffering it (§0.126)', async () => {
    // `apiBaseUrl` is a user-configured provider endpoint; a misbehaving relay
    // could stream unbounded bytes. With a tiny cap the read must reject with
    // the shared "response body too large" guard rather than buffer the body.
    process.env['OPENAWORK_IMAGE_RESPONSE_MAX_BYTES'] = '64';
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('x'.repeat(100_000), { status: 200 }),
    );

    try {
      await expect(
        generateImageWithOpenAi({
          apiBaseUrl: 'https://relay.example.com/v1',
          apiKey: 'sk-openai',
          background: 'auto',
          model: 'gpt-image-2',
          moderation: 'auto',
          outputFormat: 'png',
          prompt: '画一张海报',
          providerType: 'openai',
          quality: 'high',
          requestOverrides: {},
          size: '1024x1024',
        }),
      ).rejects.toThrow(/response body too large/);
    } finally {
      delete process.env['OPENAWORK_IMAGE_RESPONSE_MAX_BYTES'];
    }
  });

  it('sends moderation and output_compression only when provided', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ b64_json: Buffer.from('image-bytes').toString('base64') }] }),
        { status: 200 },
      ),
    );

    await generateImageWithOpenAi({
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-openai',
      background: 'transparent',
      model: 'gpt-image-2.5-flare',
      moderation: 'low',
      outputCompression: 60,
      outputFormat: 'webp',
      prompt: '画一张透明底贴纸',
      providerType: 'openai',
      quality: 'max',
      requestOverrides: {},
      size: '1024x1024',
    });

    const body = JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[0]?.[1]?.body)) as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({
      moderation: 'low',
      output_compression: 60,
      background: 'transparent',
      quality: 'max',
      model: 'gpt-image-2.5-flare',
    });

    vi.mocked(globalThis.fetch).mockClear();
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ b64_json: Buffer.from('image-bytes').toString('base64') }] }),
        { status: 200 },
      ),
    );

    await generateImageWithOpenAi({
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-openai',
      background: 'auto',
      model: 'gpt-image-2.5-flare',
      moderation: 'auto',
      outputFormat: 'png',
      prompt: '画一张海报',
      providerType: 'openai',
      quality: 'high',
      requestOverrides: {},
      size: 'auto',
    });

    const secondBody = JSON.parse(
      String(vi.mocked(globalThis.fetch).mock.calls[0]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(secondBody).not.toHaveProperty('output_compression');
    expect(secondBody['size']).toBe('auto');
  });

  it('only sends n when more than one image is requested', async () => {
    const stubSuccess = () =>
      vi
        .mocked(globalThis.fetch)
        .mockResolvedValue(
          new Response(
            JSON.stringify({ data: [{ b64_json: Buffer.from('image-bytes').toString('base64') }] }),
            { status: 200 },
          ),
        );

    stubSuccess();
    await generateImagesWithOpenAi({
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-openai',
      background: 'auto',
      count: 1,
      model: 'gpt-image-2.5-flare',
      moderation: 'auto',
      outputFormat: 'png',
      prompt: '画一张海报',
      providerType: 'openai',
      quality: 'high',
      requestOverrides: {},
      size: '1024x1024',
    });
    const singleBody = JSON.parse(
      String(vi.mocked(globalThis.fetch).mock.calls[0]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(singleBody).not.toHaveProperty('n');

    vi.mocked(globalThis.fetch).mockClear();
    stubSuccess();
    await generateImagesWithOpenAi({
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-openai',
      background: 'auto',
      count: 3,
      model: 'gpt-image-2.5-flare',
      moderation: 'auto',
      outputFormat: 'png',
      prompt: '画三张海报',
      providerType: 'openai',
      quality: 'high',
      requestOverrides: {},
      size: '1024x1024',
    });
    const multiBody = JSON.parse(
      String(vi.mocked(globalThis.fetch).mock.calls[0]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(multiBody['n']).toBe(3);
  });

  it('maps every upstream image in data[] instead of only the first', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { b64_json: Buffer.from('first').toString('base64') },
            { b64_json: Buffer.from('second').toString('base64') },
          ],
        }),
        { status: 200 },
      ),
    );

    const images = await generateImagesWithOpenAi({
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-openai',
      background: 'auto',
      count: 2,
      model: 'gpt-image-2.5-flare',
      moderation: 'auto',
      outputFormat: 'png',
      prompt: '画两张海报',
      providerType: 'openai',
      quality: 'high',
      requestOverrides: {},
      size: '1024x1024',
    });

    expect(images).toHaveLength(2);
    expect(images[0]?.bytes.toString()).toBe('first');
    expect(images[1]?.bytes.toString()).toBe('second');
  });

  it('attaches the mask file to multipart edit requests', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ b64_json: Buffer.from('edited').toString('base64') }] }),
        { status: 200 },
      ),
    );

    await editImageWithOpenAi({
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-openai',
      background: 'auto',
      inputImage: {
        bytes: Buffer.from('input-image'),
        fileName: 'input.png',
        mimeType: 'image/png',
      },
      mask: {
        bytes: Buffer.from('mask-image'),
        fileName: 'mask.png',
        mimeType: 'image/png',
      },
      model: 'gpt-image-2.5-sunburst',
      moderation: 'auto',
      outputFormat: 'png',
      prompt: '只替换遮罩区域',
      providerType: 'openai',
      quality: 'high',
      requestOverrides: {},
      size: '1024x1024',
    });

    const form = vi.mocked(globalThis.fetch).mock.calls[0]?.[1]?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('mask')).toBeInstanceOf(File);
    expect((form.get('mask') as File).name).toBe('mask.png');
  });

  it('drops the mask when provider overrides omit it', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ b64_json: Buffer.from('edited').toString('base64') }] }),
        { status: 200 },
      ),
    );

    await editImageWithOpenAi({
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-openai',
      background: 'auto',
      inputImage: {
        bytes: Buffer.from('input-image'),
        fileName: 'input.png',
        mimeType: 'image/png',
      },
      mask: {
        bytes: Buffer.from('mask-image'),
        fileName: 'mask.png',
        mimeType: 'image/png',
      },
      model: 'gpt-image-2.5-sunburst',
      moderation: 'auto',
      outputFormat: 'png',
      prompt: '只替换遮罩区域',
      providerType: 'openai',
      quality: 'high',
      requestOverrides: { omitBodyKeys: ['mask'] },
      size: '1024x1024',
    });

    const form = vi.mocked(globalThis.fetch).mock.calls[0]?.[1]?.body as FormData;
    expect(form.has('mask')).toBe(false);
  });
});

describe('generateImageStreamWithOpenAi', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('emits partial images and resolves the completed image', async () => {
    const frames = [
      sseEvent('image_generation.partial_image', {
        type: 'image_generation.partial_image',
        partial_image_index: 0,
        b64_json: b64('partial-0'),
      }),
      sseEvent('image_generation.partial_image', {
        type: 'image_generation.partial_image',
        partial_image_index: 1,
        b64_json: b64('partial-1'),
      }),
      sseEvent('image_generation.completed', {
        type: 'image_generation.completed',
        b64_json: b64('final-image'),
        revised_prompt: '一条羽毛河流',
      }),
      'data: [DONE]\n\n',
    ];
    // 逐字符切分：解析器不得依赖 chunk 与 SSE 帧边界对齐。
    stubStreamingResponse(chunkify(frames.join(''), 1));

    const partials: Array<{ index: number; bytes: string }> = [];
    const result = await generateImageStreamWithOpenAi(
      { ...STREAM_INPUT },
      {
        onPartial: (partial) =>
          partials.push({ bytes: partial.bytes.toString(), index: partial.index }),
      },
    );

    expect(partials).toEqual([
      { bytes: 'partial-0', index: 0 },
      { bytes: 'partial-1', index: 1 },
    ]);
    expect(result.bytes.toString()).toBe('final-image');
    expect(result.revisedPrompt).toBe('一条羽毛河流');
    expect(result.mimeType).toBe('image/png');
  });

  it('falls back to the last partial image when no completed event arrives', async () => {
    stubStreamingResponse([
      sseEvent('image_generation.partial_image', {
        type: 'image_generation.partial_image',
        partial_image_index: 0,
        b64_json: b64('partial-0'),
      }),
      sseEvent('image_generation.partial_image', {
        type: 'image_generation.partial_image',
        partial_image_index: 1,
        b64_json: b64('partial-1'),
      }),
    ]);

    const result = await generateImageStreamWithOpenAi({ ...STREAM_INPUT });
    expect(result.bytes.toString()).toBe('partial-1');
  });

  it('requests stream mode with a bounded partial_images budget', async () => {
    stubStreamingResponse([
      sseEvent('image_generation.completed', {
        type: 'image_generation.completed',
        b64_json: b64('final-image'),
      }),
    ]);

    await generateImageStreamWithOpenAi({ ...STREAM_INPUT });

    const fetchInit = vi.mocked(globalThis.fetch).mock.calls[0]?.[1];
    const body = JSON.parse(String(fetchInit?.body)) as Record<string, unknown>;
    expect(body['stream']).toBe(true);
    expect(body['partial_images']).toBe(2);
    expect(body).not.toHaveProperty('n');
  });

  it('rejects when the stream carries no usable image data', async () => {
    stubStreamingResponse([
      ': heartbeat\n\n',
      sseEvent('image_generation.partial_image', {
        type: 'image_generation.partial_image',
        partial_image_index: 0,
      }),
    ]);

    await expect(generateImageStreamWithOpenAi({ ...STREAM_INPUT })).rejects.toThrow(
      /未返回可用的图像数据/,
    );
  });
});

describe('openai image generation upstream error contract', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const generate = () =>
    generateImageWithOpenAi({
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-openai',
      background: 'auto',
      model: 'gpt-image-2.5-flare',
      moderation: 'auto',
      outputFormat: 'png',
      prompt: '画一张海报',
      providerType: 'openai',
      quality: 'high',
      requestOverrides: {},
      size: '1024x1024',
    });

  const stubErrorResponse = (status: number, body: unknown) => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(JSON.stringify(body), { status }));
  };

  it('surfaces moderation_blocked as a non-retryable, detail-free failure', async () => {
    stubErrorResponse(400, {
      error: {
        type: 'image_generation_user_error',
        code: 'moderation_blocked',
        moderation_details: { moderation_stage: 'input', categories: ['harassment'] },
      },
    });

    const error = await generate().catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      name: 'OpenAiImageGenerationError',
      code: 'moderation_blocked',
      upstreamType: 'image_generation_user_error',
      moderationStage: 'input',
      moderationCategories: ['harassment'],
      retryable: false,
      statusCode: 400,
    });
    // 官方要求：详情只进日志，面向用户的文案保持通用。
    const message = (error as Error).message;
    expect(message).toContain('内容安全审核');
    expect(message).not.toContain('harassment');
  });

  it('does not retry image_generation_user_error even on 5xx', async () => {
    stubErrorResponse(500, {
      error: { type: 'image_generation_user_error', code: 'invalid_prompt_reference' },
    });

    const error = await generate().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ retryable: false, statusCode: 500 });
  });

  it('does not retry quota failures', async () => {
    stubErrorResponse(429, {
      error: { type: 'insufficient_quota', code: 'insufficient_quota', message: 'quota exceeded' },
    });

    const error = await generate().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ retryable: false, statusCode: 429 });
  });

  it('still retries transient rate limits and server failures', async () => {
    stubErrorResponse(429, { error: { code: 'rate_limit_exceeded', message: 'slow down' } });
    await expect(generate()).rejects.toMatchObject({ retryable: true, statusCode: 429 });

    stubErrorResponse(502, { error: { message: 'bad gateway' } });
    await expect(generate()).rejects.toMatchObject({ retryable: true, statusCode: 502 });
  });
});
