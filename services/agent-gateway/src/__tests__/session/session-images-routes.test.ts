import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const mocks = vi.hoisted(() => {
  class MockOpenAiImageGenerationError extends Error {
    public readonly retryable: boolean;

    public readonly statusCode: number;

    public constructor(message: string, options: { retryable: boolean; statusCode: number }) {
      super(message);
      this.name = 'OpenAiImageGenerationError';
      this.retryable = options.retryable;
      this.statusCode = options.statusCode;
    }
  }

  return {
    MockOpenAiImageGenerationError,
    editImageWithOpenAiMock: vi.fn(),
    createArtifactMock: vi.fn(),
    generateImageWithOpenAiMock: vi.fn(),
    getArtifactByIdMock: vi.fn(),
    getImageProviderConfigMock: vi.fn(),
    listArtifactsMock: vi.fn(),
    parseStoredImageGenerationDefaultsMock: vi.fn(),
    resolveModelRouteFromProviderMock: vi.fn(),
    sqliteGetMock: vi.fn(),
  };
});

vi.mock('../../infra/auth.js', () => ({
  requireAuth: async (request: { user?: { sub: string } }) => {
    request.user = { sub: 'user-a' };
  },
}));

vi.mock('../../infra/db.js', () => ({
  sqliteGet: mocks.sqliteGetMock,
}));

vi.mock('../../session/artifact-content-store.js', () => ({
  createArtifact: mocks.createArtifactMock,
  getArtifactById: mocks.getArtifactByIdMock,
}));

vi.mock('@openAwork/artifacts', () => ({
  ArtifactManagerImpl: class {
    async list() {
      return mocks.listArtifactsMock();
    }
  },
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async () => Buffer.from('input-image-binary')),
}));

vi.mock('../../infra/storage-paths.js', () => ({
  resolveGatewayArtifactsIndexPath: () => '/tmp/test-artifacts-index.json',
}));

vi.mock('../../provider/model-router.js', () => ({
  resolveModelRouteFromProvider: mocks.resolveModelRouteFromProviderMock,
}));

vi.mock('../../provider/provider-config.js', () => ({
  DEFAULT_IMAGE_GENERATION_DEFAULTS: {
    size: '1024x1024',
    quality: 'medium',
    outputFormat: 'png',
    background: 'auto',
  },
  imageGenerationDefaultsSchema: z.object({
    size: z.string(),
    quality: z.enum(['low', 'medium', 'high']),
    outputFormat: z.enum(['png', 'jpeg', 'webp']),
    background: z.enum(['auto', 'opaque']),
  }),
  getImageProviderConfig: mocks.getImageProviderConfigMock,
  parseStoredImageGenerationDefaults: mocks.parseStoredImageGenerationDefaultsMock,
}));

vi.mock('../../image-generation/openai-image-generation.js', () => ({
  OpenAiImageGenerationError: mocks.MockOpenAiImageGenerationError,
  editImageWithOpenAi: mocks.editImageWithOpenAiMock,
  generateImageWithOpenAi: mocks.generateImageWithOpenAiMock,
}));

import { sessionImagesRoutes } from '../../routes/session-images.js';

describe('session images routes', () => {
  beforeEach(() => {
    mocks.createArtifactMock.mockReset();
    mocks.editImageWithOpenAiMock.mockReset();
    mocks.generateImageWithOpenAiMock.mockReset();
    mocks.getArtifactByIdMock.mockReset();
    mocks.getImageProviderConfigMock.mockReset();
    mocks.listArtifactsMock.mockReset();
    mocks.parseStoredImageGenerationDefaultsMock.mockReset();
    mocks.resolveModelRouteFromProviderMock.mockReset();
    mocks.sqliteGetMock.mockReset();

    mocks.parseStoredImageGenerationDefaultsMock.mockReturnValue({
      size: '1024x1024',
      quality: 'medium',
      outputFormat: 'png',
      background: 'auto',
    });
    mocks.getImageProviderConfigMock.mockResolvedValue({
      provider: { id: 'openai', type: 'openai' },
      modelId: 'gpt-image-2',
      model: {
        id: 'gpt-image-2',
        label: 'GPT Image 2',
        enabled: true,
        supportsImageGeneration: true,
        supportsImageGeneration4K: false,
      },
    });
    mocks.listArtifactsMock.mockResolvedValue([
      {
        id: 'artifact-input-1',
        sessionId: 'session-1',
        type: 'document',
        name: 'input.png',
        path: '/tmp/input.png',
        mimeType: 'image/png',
        createdAt: Date.now(),
      },
    ]);
    mocks.resolveModelRouteFromProviderMock.mockReturnValue({
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-openai',
      model: 'gpt-image-2',
      providerType: 'openai',
      requestOverrides: {},
    });
    mocks.editImageWithOpenAiMock.mockResolvedValue({
      bytes: Buffer.from('edited-image-binary'),
      mimeType: 'image/png',
      outputFormat: 'png',
      prompt: '把这张图改成极简蓝鲸海报',
      quality: 'medium',
      requestId: 'req-image-edit-1',
      revisedPrompt: '一张极简蓝鲸海报',
      size: '1024x1024',
    });
    mocks.getArtifactByIdMock.mockReturnValue(undefined);
    mocks.sqliteGetMock.mockImplementation((query: string) => {
      if (query.includes('FROM sessions')) {
        return { id: 'session-1' };
      }
      return { value: '{}' };
    });
  });

  it('returns 404 when session ownership check fails', async () => {
    mocks.sqliteGetMock.mockReturnValue(undefined);

    const app = Fastify();
    await app.register(sessionImagesRoutes);
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/session-404/images/generations',
      payload: { prompt: '画一只鲸鱼' },
    });

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body)).toEqual({ error: 'Session not found' });

    await app.close();
  });

  it('allows 4K image requests even when the selected model declares no 4K support', async () => {
    mocks.generateImageWithOpenAiMock.mockResolvedValue({
      bytes: Buffer.from('4k-image-binary'),
      mimeType: 'image/png',
      outputFormat: 'png',
      prompt: '画一张 4K 蓝鲸海报',
      quality: 'high',
      requestId: 'req-image-4k-1',
      revisedPrompt: '一张 4K 蓝鲸海报',
      size: '3840x2160',
    });
    mocks.createArtifactMock.mockReturnValue({
      id: 'artifact-image-4k-1',
      sessionId: 'session-1',
      userId: 'user-a',
      type: 'image',
      title: '画一张 4K 蓝鲸海报',
      content: 'data:image/png;base64,NGstaW1hZ2UtYmluYXJ5',
      version: 1,
      parentVersionId: null,
      metadata: { modelId: 'gpt-image-2' },
      createdAt: '2026-04-22T00:00:00.000Z',
      updatedAt: '2026-04-22T00:00:00.000Z',
    });

    const app = Fastify();
    await app.register(sessionImagesRoutes);
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/session-1/images/generations',
      payload: { prompt: '画一张 4K 蓝鲸海报', size: '3840x2160' },
    });

    expect(response.statusCode).toBe(201);
    expect(mocks.generateImageWithOpenAiMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: '画一张 4K 蓝鲸海报',
        size: '3840x2160',
        quality: 'high',
        outputFormat: 'png',
        background: 'auto',
      }),
    );
    expect(JSON.parse(response.body)).toMatchObject({
      parameters: {
        providerId: 'openai',
        modelId: 'gpt-image-2',
        size: '3840x2160',
        quality: 'high',
        outputFormat: 'png',
        background: 'auto',
      },
    });

    await app.close();
  });

  it('returns 400 when no image model is configured', async () => {
    mocks.getImageProviderConfigMock.mockResolvedValue(null);

    const app = Fastify();
    await app.register(sessionImagesRoutes);
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/session-1/images/generations',
      payload: { prompt: '画一只鲸鱼' },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: {
        code: 'image_model_not_configured',
        message: '当前未配置可用的图片生成模型。',
        retryable: false,
      },
    });

    await app.close();
  });

  it('creates an image artifact and returns route metadata', async () => {
    mocks.generateImageWithOpenAiMock.mockResolvedValue({
      bytes: Buffer.from('png-image-binary'),
      mimeType: 'image/png',
      outputFormat: 'png',
      prompt: '画一只极简蓝鲸',
      quality: 'medium',
      requestId: 'req-image-1',
      revisedPrompt: '一张极简蓝鲸海报',
      size: '1024x1024',
    });
    mocks.createArtifactMock.mockReturnValue({
      id: 'artifact-image-1',
      sessionId: 'session-1',
      userId: 'user-a',
      type: 'image',
      title: '画一只极简蓝鲸',
      content: 'data:image/png;base64,cG5nLWltYWdlLWJpbmFyeQ==',
      version: 1,
      parentVersionId: null,
      metadata: { modelId: 'gpt-image-2' },
      createdAt: '2026-04-22T00:00:00.000Z',
      updatedAt: '2026-04-22T00:00:00.000Z',
    });

    const app = Fastify();
    await app.register(sessionImagesRoutes);
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/session-1/images/generations',
      payload: { prompt: '画一只极简蓝鲸' },
    });

    expect(response.statusCode).toBe(201);
    expect(mocks.generateImageWithOpenAiMock).toHaveBeenCalledWith(
      expect.objectContaining({
        apiBaseUrl: 'https://api.openai.com/v1',
        model: 'gpt-image-2',
        prompt: '画一只极简蓝鲸',
        size: '1024x1024',
        quality: 'medium',
        outputFormat: 'png',
        background: 'auto',
      }),
    );
    expect(mocks.createArtifactMock).toHaveBeenCalledWith(
      'user-a',
      expect.objectContaining({
        sessionId: 'session-1',
        type: 'image',
        mimeType: 'image/png',
        createdBy: 'agent',
        metadata: expect.objectContaining({
          sourceKind: 'gpt_image_2_generation',
          providerId: 'openai',
          modelId: 'gpt-image-2',
          prompt: '画一只极简蓝鲸',
          revisedPrompt: '一张极简蓝鲸海报',
        }),
      }),
    );

    expect(JSON.parse(response.body)).toMatchObject({
      artifact: { id: 'artifact-image-1', type: 'image' },
      revisedPrompt: '一张极简蓝鲸海报',
      parameters: {
        providerId: 'openai',
        modelId: 'gpt-image-2',
        size: '1024x1024',
        quality: 'medium',
        outputFormat: 'png',
        background: 'auto',
      },
    });

    await app.close();
  });

  it('maps upstream image generation errors into structured API errors', async () => {
    mocks.generateImageWithOpenAiMock.mockRejectedValue(
      new mocks.MockOpenAiImageGenerationError('图片生成上游请求失败。', {
        retryable: true,
        statusCode: 429,
      }),
    );

    const app = Fastify();
    await app.register(sessionImagesRoutes);
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/session-1/images/generations',
      payload: { prompt: '画一只极简蓝鲸', quality: 'high' },
    });

    expect(response.statusCode).toBe(429);
    expect(JSON.parse(response.body)).toEqual({
      error: {
        code: 'image_generation_failed',
        message: '图片生成上游请求失败。',
        retryable: true,
      },
    });

    await app.close();
  });

  it('uses edit flow when inputArtifacts are provided', async () => {
    mocks.createArtifactMock.mockReturnValue({
      id: 'artifact-image-edit-1',
      sessionId: 'session-1',
      userId: 'user-a',
      type: 'image',
      title: '把这张图改成极简蓝鲸海报',
      content: 'data:image/png;base64,ZWRpdGVkLWltYWdlLWJpbmFyeQ==',
      version: 1,
      parentVersionId: null,
      metadata: { modelId: 'gpt-image-2', sourceArtifactId: 'artifact-input-1' },
      createdAt: '2026-04-22T00:00:00.000Z',
      updatedAt: '2026-04-22T00:00:00.000Z',
    });

    const app = Fastify();
    await app.register(sessionImagesRoutes);
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/session-1/images/generations',
      payload: {
        prompt: '把这张图改成极简蓝鲸海报',
        inputArtifacts: [
          { artifactId: 'artifact-input-1', fileName: 'input.png', mimeType: 'image/png' },
        ],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mocks.editImageWithOpenAiMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inputImage: expect.objectContaining({
          fileName: 'input.png',
          mimeType: 'image/png',
          bytes: expect.any(Buffer),
        }),
      }),
    );
    expect(mocks.generateImageWithOpenAiMock).not.toHaveBeenCalled();
    expect(mocks.createArtifactMock).toHaveBeenCalledWith(
      'user-a',
      expect.objectContaining({
        metadata: expect.objectContaining({
          sourceArtifactId: 'artifact-input-1',
        }),
      }),
    );
    expect(JSON.parse(response.body)).toMatchObject({
      artifact: { id: 'artifact-image-edit-1', type: 'image' },
      messageSummary:
        '已编辑 1 张图片（gpt-image-2 · 1024x1024 · PNG）。 上游已对提示词做轻微改写。',
    });

    await app.close();
  });

  it('uses stored content image artifacts as edit inputs when upload records are absent', async () => {
    mocks.listArtifactsMock.mockResolvedValue([]);
    mocks.getArtifactByIdMock.mockReturnValue({
      id: 'artifact-generated-1',
      sessionId: 'session-1',
      userId: 'user-a',
      type: 'image',
      title: '已生成的蓝鲸图',
      content: `data:image/webp;base64,${Buffer.from('stored-image-binary').toString('base64')}`,
      version: 1,
      parentVersionId: null,
      metadata: {
        fileName: 'generated-whale.webp',
        mimeType: 'image/webp',
      },
      createdAt: '2026-04-22T00:00:00.000Z',
      updatedAt: '2026-04-22T00:00:00.000Z',
    });
    mocks.createArtifactMock.mockReturnValue({
      id: 'artifact-image-edit-2',
      sessionId: 'session-1',
      userId: 'user-a',
      type: 'image',
      title: '继续编辑蓝鲸图',
      content: 'data:image/png;base64,ZWRpdGVkLWltYWdlLWJpbmFyeQ==',
      version: 1,
      parentVersionId: null,
      metadata: { modelId: 'gpt-image-2', sourceArtifactId: 'artifact-generated-1' },
      createdAt: '2026-04-22T00:00:00.000Z',
      updatedAt: '2026-04-22T00:00:00.000Z',
    });

    const app = Fastify();
    await app.register(sessionImagesRoutes);
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/session-1/images/generations',
      payload: {
        prompt: '把这张已生成图片改成海报风格',
        inputArtifacts: [{ artifactId: 'artifact-generated-1' }],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mocks.editImageWithOpenAiMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inputImage: expect.objectContaining({
          bytes: Buffer.from('stored-image-binary'),
          fileName: 'generated-whale.webp',
          mimeType: 'image/webp',
        }),
      }),
    );
    expect(mocks.createArtifactMock).toHaveBeenCalledWith(
      'user-a',
      expect.objectContaining({
        metadata: expect.objectContaining({
          sourceArtifactId: 'artifact-generated-1',
        }),
      }),
    );

    await app.close();
  });

  it('rejects reference artifacts that are not images even if client spoofs mimeType', async () => {
    mocks.listArtifactsMock.mockResolvedValue([
      {
        id: 'artifact-input-1',
        sessionId: 'session-1',
        type: 'document',
        name: 'not-image.txt',
        path: '/tmp/input.txt',
        mimeType: 'text/plain',
        createdAt: Date.now(),
      },
    ]);

    const app = Fastify();
    await app.register(sessionImagesRoutes);
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/session-1/images/generations',
      payload: {
        prompt: '把这份文本伪装成图片编辑',
        inputArtifacts: [
          { artifactId: 'artifact-input-1', fileName: 'spoof.png', mimeType: 'image/png' },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: {
        code: 'image_input_invalid',
        message: '参考图不存在、不可访问，或不是受支持的图片类型。',
        retryable: false,
      },
    });
    expect(mocks.editImageWithOpenAiMock).not.toHaveBeenCalled();

    await app.close();
  });
});
