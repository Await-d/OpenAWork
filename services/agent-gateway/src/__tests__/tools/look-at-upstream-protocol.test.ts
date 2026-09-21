/**
 * Regression: `runLookAtTool` must forward the resolved
 * `upstreamProtocol` from its `ModelRouteConfig` to `runUpstreamGenerate`
 * for the multimodal Looker subagent.
 *
 * Prior to the fix, every look_at call silently degraded into the AI
 * SDK's default `chat_completions` protocol — breaking users on
 * `anthropic_messages` (vision is one of Claude's strongest features
 * and was the most user-visible regression) and OpenAI `responses`
 * (the GPT-5 / o-series family).
 *
 * The test goes through the public `runLookAtTool` entry-point with an
 * inline `imageData` payload (so we never touch the filesystem and skip
 * `validateWorkspacePath`). Provider config + model router are mocked
 * to deterministically yield a route whose protocol we control.
 */

import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelRouteConfig } from '../../provider/model-router.js';

const mocks = vi.hoisted(() => ({
  runUpstreamGenerate: vi.fn(),
  sqliteGet: vi.fn(),
  sqliteRun: vi.fn(),
  fetch: vi.fn(),
  lookup: vi.fn(),
  listManagedAgentsForUser: vi.fn(() => [] as unknown[]),
  selectDelegatedModelForUser: vi.fn(() => null),
  getReferenceAgentModelEntries: vi.fn(() => [] as unknown[]),
  getProviderConfigForSelection: vi.fn(async () => null),
  resolveModelRoute: vi.fn(),
  resolveModelRouteFromProvider: vi.fn(),
  appendSessionMessageV2: vi.fn(),
  validateWorkspacePath: vi.fn((p: string) => p),
}));

vi.mock('../../infra/db.js', () => ({
  sqliteGet: mocks.sqliteGet,
  sqliteRun: mocks.sqliteRun,
  WORKSPACE_ROOT: '/tmp/workspace',
  WORKSPACE_ROOTS: ['/tmp/workspace'],
  WORKSPACE_ACCESS_MODE: 'unrestricted' as const,
  WORKSPACE_ACCESS_RESTRICTED: false,
}));

vi.mock('../../agent/agent-catalog.js', () => ({
  listManagedAgentsForUser: mocks.listManagedAgentsForUser,
}));

vi.mock('../../task/task-model-selection.js', () => ({
  selectDelegatedModelForUser: mocks.selectDelegatedModelForUser,
}));

vi.mock('../../task/task-model-reference-snapshot.js', () => ({
  getReferenceAgentModelEntries: mocks.getReferenceAgentModelEntries,
}));

vi.mock('../../provider/provider-config.js', () => ({
  getProviderConfigForSelection: mocks.getProviderConfigForSelection,
}));

vi.mock('../../provider/model-router.js', () => ({
  resolveModelRoute: mocks.resolveModelRoute,
  resolveModelRouteFromProvider: mocks.resolveModelRouteFromProvider,
}));

vi.mock('../../message/message-v2-adapter.js', () => ({
  appendSessionMessageV2: mocks.appendSessionMessageV2,
}));

vi.mock('../../workspace/workspace-paths.js', () => ({
  validateWorkspacePath: mocks.validateWorkspacePath,
}));

vi.mock('node:dns/promises', () => ({
  lookup: mocks.lookup,
}));

vi.mock('../../v2-runtime/upstream/index.js', async (orig) => {
  type UpstreamModule = typeof UpstreamActual;
  const actual = await (orig() as Promise<UpstreamModule>);
  return {
    ...actual,
    runUpstreamGenerate: mocks.runUpstreamGenerate,
  };
});

import { runLookAtTool } from '../../tools/look-at-tools.js';
import type * as UpstreamActual from '../../v2-runtime/upstream/index.js';
import { __setDnsLookupForTests } from 'open-websearch/build/utils/urlSafety.js';

function createRoute(overrides?: Partial<ModelRouteConfig>): ModelRouteConfig {
  return {
    model: overrides?.model ?? 'claude-3-5-sonnet-latest',
    apiBaseUrl: overrides?.apiBaseUrl ?? 'https://api.anthropic.com/v1',
    apiKey: overrides?.apiKey ?? 'sk-test',
    maxTokens: overrides?.maxTokens ?? 2048,
    temperature: overrides?.temperature ?? 0.2,
    upstreamProtocol: overrides?.upstreamProtocol ?? 'anthropic_messages',
    requestOverrides: overrides?.requestOverrides ?? {},
    supportsThinking: overrides?.supportsThinking ?? false,
    providerType: overrides?.providerType ?? 'anthropic',
  };
}

// 1×1 transparent PNG, base64 — small enough to keep the test cheap.
const SAMPLE_IMAGE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const SAMPLE_JPG_DATA_URL = 'data:image/jpg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2w==';

describe('runLookAtTool — upstreamProtocol forwarding', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => {
      if (typeof m === 'function' && 'mockReset' in m) {
        (m as ReturnType<typeof vi.fn>).mockReset();
      }
    });
    // Re-prime defaults that the implementation relies on every test.
    mocks.listManagedAgentsForUser.mockReturnValue([]);
    mocks.selectDelegatedModelForUser.mockReturnValue(null);
    mocks.getReferenceAgentModelEntries.mockReturnValue([]);
    mocks.getProviderConfigForSelection.mockResolvedValue(null);
    mocks.validateWorkspacePath.mockImplementation((p: string) => p);
    mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    // 上游 urlSafety.js 位于 node_modules，是 vitest 的外部依赖：对 node:dns/promises 的
    // vi.mock 不会穿透到它。改用上游为此导出的测试钩子，让预检走同一个 DNS mock。
    __setDnsLookupForTests(mocks.lookup);
    vi.stubGlobal('fetch', mocks.fetch);
  });

  afterEach(() => {
    __setDnsLookupForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('forwards anthropic_messages so vision calls hit the native API', async () => {
    mocks.resolveModelRoute.mockReturnValue(
      createRoute({ upstreamProtocol: 'anthropic_messages', providerType: 'anthropic' }),
    );
    mocks.runUpstreamGenerate.mockReturnValue(
      Effect.succeed({
        text: 'image describes a transparent pixel',
        inputTokens: 10,
        outputTokens: 5,
        finishReason: 'stop',
      }),
    );

    await runLookAtTool({
      imageData: SAMPLE_IMAGE_DATA_URL,
      goal: 'describe the image',
      parentSessionId: 'parent-session',
      userId: 'user-1',
    });

    expect(mocks.runUpstreamGenerate).toHaveBeenCalledTimes(1);
    const callArgs = mocks.runUpstreamGenerate.mock.calls[0]?.[0] as
      { providerType?: string; upstreamProtocol?: string } | undefined;
    expect(callArgs?.providerType).toBe('anthropic');
    expect(callArgs?.upstreamProtocol).toBe('anthropic_messages');
  });

  it('forwards responses for OpenAI providers configured for the Responses API', async () => {
    mocks.resolveModelRoute.mockReturnValue(
      createRoute({
        upstreamProtocol: 'responses',
        providerType: 'openai',
        model: 'gpt-4o',
        apiBaseUrl: 'https://api.openai.com/v1',
      }),
    );
    mocks.runUpstreamGenerate.mockReturnValue(
      Effect.succeed({
        text: 'ok',
        inputTokens: 0,
        outputTokens: 0,
        finishReason: 'stop',
      }),
    );

    await runLookAtTool({
      imageData: SAMPLE_IMAGE_DATA_URL,
      goal: 'describe',
      parentSessionId: 'parent-session',
      userId: 'user-1',
    });

    const callArgs = mocks.runUpstreamGenerate.mock.calls[0]?.[0] as
      { upstreamProtocol?: string } | undefined;
    expect(callArgs?.upstreamProtocol).toBe('responses');
  });

  it('normalizes image/jpg data URLs to image/jpeg before the upstream call', async () => {
    mocks.resolveModelRoute.mockReturnValue(
      createRoute({
        upstreamProtocol: 'responses',
        providerType: 'openai',
        model: 'gpt-4o',
        apiBaseUrl: 'https://api.openai.com/v1',
      }),
    );
    mocks.runUpstreamGenerate.mockReturnValue(
      Effect.succeed({
        text: 'ok',
        inputTokens: 0,
        outputTokens: 0,
        finishReason: 'stop',
      }),
    );

    await runLookAtTool({
      imageData: SAMPLE_JPG_DATA_URL,
      goal: 'describe jpg',
      parentSessionId: 'parent-session',
      userId: 'user-1',
    });

    const callArgs = mocks.runUpstreamGenerate.mock.calls[0]?.[0] as
      { messages?: Array<{ content?: unknown }> } | undefined;
    const content = callArgs?.messages?.[0]?.content;
    expect(Array.isArray(content)).toBe(true);
    const mediaPart = (content as Array<Record<string, unknown>>).find(
      (part) => part['type'] === 'media',
    );
    expect(mediaPart).toMatchObject({
      data: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2w==',
      mediaType: 'image/jpeg',
    });
  });

  it('downloads remote image URLs passed via image_data before calling the upstream model', async () => {
    mocks.resolveModelRoute.mockReturnValue(
      createRoute({
        upstreamProtocol: 'responses',
        providerType: 'openai',
        model: 'gpt-4o',
        apiBaseUrl: 'https://api.openai.com/v1',
      }),
    );
    mocks.fetch.mockResolvedValue(
      new Response(new Uint8Array([255, 216, 255, 219]), {
        status: 200,
        headers: {
          'content-type': 'image/jpeg',
        },
      }),
    );
    mocks.runUpstreamGenerate.mockReturnValue(
      Effect.succeed({
        text: 'ok',
        inputTokens: 0,
        outputTokens: 0,
        finishReason: 'stop',
      }),
    );

    await runLookAtTool({
      imageData: 'https://ichef.bbci.co.uk/ace/standard/640/example.jpg',
      goal: 'describe remote image',
      parentSessionId: 'parent-session',
      userId: 'user-1',
    });

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://ichef.bbci.co.uk/ace/standard/640/example.jpg',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );

    const callArgs = mocks.runUpstreamGenerate.mock.calls[0]?.[0] as
      { messages?: Array<{ content?: unknown }> } | undefined;
    const content = callArgs?.messages?.[0]?.content;
    expect(Array.isArray(content)).toBe(true);
    const mediaPart = (content as Array<Record<string, unknown>>).find(
      (part) => part['type'] === 'media',
    );
    expect(mediaPart).toMatchObject({
      mediaType: 'image/jpeg',
    });
    expect(String(mediaPart?.['data'] ?? '')).toContain('data:image/jpeg;base64,');
    expect(String(mediaPart?.['data'] ?? '')).not.toContain('https://');
  });

  it('rejects remote image URLs that return non-image content', async () => {
    mocks.resolveModelRoute.mockReturnValue(
      createRoute({
        upstreamProtocol: 'responses',
        providerType: 'openai',
        model: 'gpt-4o',
        apiBaseUrl: 'https://api.openai.com/v1',
      }),
    );
    mocks.fetch.mockResolvedValue(
      new Response('<html>blocked</html>', {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
        },
      }),
    );

    await expect(
      runLookAtTool({
        imageData: 'https://ichef.bbci.co.uk/ace/standard/640/not-an-image.jpg',
        goal: 'describe remote image',
        parentSessionId: 'parent-session',
        userId: 'user-1',
      }),
    ).rejects.toThrow(/did not return an image content-type/);

    expect(mocks.runUpstreamGenerate).not.toHaveBeenCalled();
  });

  it('rejects localhost and private-network remote image URLs before fetch', async () => {
    await expect(
      runLookAtTool({
        imageData: 'http://127.0.0.1:3000/internal.png',
        goal: 'describe remote image',
        parentSessionId: 'parent-session',
        userId: 'user-1',
      }),
    ).rejects.toThrow(/only supports public http\(s\) URLs/);

    mocks.lookup.mockResolvedValueOnce([{ address: '10.0.0.8', family: 4 }]);

    await expect(
      runLookAtTool({
        imageData: 'https://cluster.internal/image.png',
        goal: 'describe remote image',
        parentSessionId: 'parent-session',
        userId: 'user-1',
      }),
    ).rejects.toThrow(/only supports public http\(s\) URLs/);

    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.runUpstreamGenerate).not.toHaveBeenCalled();
  });

  it('rejects redirects to private targets instead of following them', async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1:3000/internal.png' },
      }),
    );

    await expect(
      runLookAtTool({
        imageData: 'https://cdn.example.com/photo.png',
        goal: 'describe remote image',
        parentSessionId: 'parent-session',
        userId: 'user-1',
      }),
    ).rejects.toThrow(/only supports public http\(s\) URLs/);

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0]?.[0]).toBe('https://cdn.example.com/photo.png');
    expect(mocks.runUpstreamGenerate).not.toHaveBeenCalled();
  });

  // 回归：工具描述承诺 image_data 支持「裸 base64」。旧实现把无前缀的输入推成
  // application/octet-stream，被上游白名单拒绝；现按魔数嗅探真实格式。
  it('裸 base64 的 image_data 按魔数嗅探为 image/png 并内联上送', async () => {
    const bareBase64 = SAMPLE_IMAGE_DATA_URL.slice(SAMPLE_IMAGE_DATA_URL.indexOf('base64,') + 7);
    mocks.resolveModelRoute.mockReturnValue(createRoute());
    mocks.runUpstreamGenerate.mockReturnValue(
      Effect.succeed({
        text: 'ok',
        inputTokens: 0,
        outputTokens: 0,
        finishReason: 'stop',
      }),
    );

    await runLookAtTool({
      imageData: bareBase64,
      goal: 'describe bare base64',
      parentSessionId: 'parent-session',
      userId: 'user-1',
    });

    const callArgs = mocks.runUpstreamGenerate.mock.calls[0]?.[0] as
      { messages?: Array<{ content?: unknown }> } | undefined;
    const mediaPart = (callArgs?.messages?.[0]?.content as Array<Record<string, unknown>>).find(
      (part) => part['type'] === 'media',
    );
    expect(mediaPart).toMatchObject({
      data: `data:image/png;base64,${bareBase64}`,
      mediaType: 'image/png',
    });
  });

  it('无法识别图片格式的 image_data 给出可读错误而不是打上游', async () => {
    await expect(
      runLookAtTool({
        imageData: Buffer.from('this is definitely not an image payload at all').toString('base64'),
        goal: 'describe',
        parentSessionId: 'parent-session',
        userId: 'user-1',
      }),
    ).rejects.toThrow(/无法识别图片格式/);

    expect(mocks.runUpstreamGenerate).not.toHaveBeenCalled();
  });

  it('BMP 的裸 base64 被明确拒绝（不在上游白名单内）', async () => {
    await expect(
      runLookAtTool({
        imageData: Buffer.concat([Buffer.from('BM'), Buffer.alloc(16)]).toString('base64'),
        goal: 'describe',
        parentSessionId: 'parent-session',
        userId: 'user-1',
      }),
    ).rejects.toThrow(/不支持 image\/bmp/);

    expect(mocks.runUpstreamGenerate).not.toHaveBeenCalled();
  });
});
