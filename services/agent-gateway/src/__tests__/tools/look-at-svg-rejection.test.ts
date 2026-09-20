/**
 * Regression: `.svg` is inferred as `image/svg+xml` and passes the generic
 * `isImageMime` gate, but the upstream protocol whitelist (`IMAGE_MIMES` in
 * `@openAwork/opencode-llm`) excludes it. Forwarding SVG produced a cryptic
 * provider error (`... does not support media type image/svg+xml`) instead of
 * the intended clear rejection. `look_at` must now fail fast with an
 * actionable Chinese message before reading the file, creating the child
 * session or issuing any upstream request, while png/text inputs keep working.
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
  stat: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  stat: mocks.stat,
  readFile: mocks.readFile,
}));

vi.mock('node:dns/promises', () => ({
  lookup: mocks.lookup,
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

const SVG_UNSUPPORTED_MESSAGE =
  'look_at 不支持 SVG（image/svg+xml）：上游多模态模型无法解析该格式，请先将 SVG 转换为 PNG/JPEG/WebP 后再分析。';
const SVG_DATA_URL =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function createRoute(overrides?: Partial<ModelRouteConfig>): ModelRouteConfig {
  return {
    model: overrides?.model ?? 'gpt-4o',
    apiBaseUrl: overrides?.apiBaseUrl ?? 'https://api.openai.com/v1',
    apiKey: overrides?.apiKey ?? 'sk-test',
    maxTokens: overrides?.maxTokens ?? 2048,
    temperature: overrides?.temperature ?? 0.2,
    upstreamProtocol: overrides?.upstreamProtocol ?? 'responses',
    requestOverrides: overrides?.requestOverrides ?? {},
    supportsThinking: overrides?.supportsThinking ?? false,
    providerType: overrides?.providerType ?? 'openai',
  };
}

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error('expected runLookAtTool to reject');
}

function expectNoProviderWork(): void {
  expect(mocks.runUpstreamGenerate).not.toHaveBeenCalled();
  expect(mocks.appendSessionMessageV2).not.toHaveBeenCalled();
  expect(mocks.sqliteRun).not.toHaveBeenCalled();
}

describe('runLookAtTool — SVG rejection', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => {
      if (typeof m === 'function' && 'mockReset' in m) {
        (m as ReturnType<typeof vi.fn>).mockReset();
      }
    });
    mocks.listManagedAgentsForUser.mockReturnValue([]);
    mocks.getProviderConfigForSelection.mockResolvedValue(null);
    mocks.validateWorkspacePath.mockImplementation((p: string) => p);
    mocks.resolveModelRoute.mockReturnValue(createRoute());
    mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    // 上游 urlSafety.js 位于 node_modules，是 vitest 的外部依赖：对 node:dns/promises 的
    // vi.mock 不会穿透到它。改用上游为此导出的测试钩子，让预检走同一个 DNS mock。
    __setDnsLookupForTests(mocks.lookup);
    mocks.stat.mockResolvedValue({ size: 128 } as never);
    mocks.runUpstreamGenerate.mockReturnValue(
      Effect.succeed({
        text: 'ok',
        inputTokens: 1,
        outputTokens: 1,
        finishReason: 'stop',
      }),
    );
    vi.stubGlobal('fetch', mocks.fetch);
  });

  afterEach(() => {
    __setDnsLookupForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('粘贴的 SVG data URL 被拒绝，且不创建子会话、不打上游', async () => {
    const error = await captureError(
      runLookAtTool({
        imageData: SVG_DATA_URL,
        goal: 'analyze svg',
        parentSessionId: 'parent',
        userId: 'user-1',
      }),
    );

    expect(error.message).toBe(SVG_UNSUPPORTED_MESSAGE);
    expectNoProviderWork();
  });

  it('.svg 文件路径在读取文件之前即被拒绝', async () => {
    const error = await captureError(
      runLookAtTool({
        filePath: '/tmp/workspace/logo.svg',
        goal: 'analyze svg',
        parentSessionId: 'parent',
        userId: 'user-1',
      }),
    );

    expect(error.message).toBe(SVG_UNSUPPORTED_MESSAGE);
    expect(mocks.readFile).not.toHaveBeenCalled();
    expectNoProviderWork();
  });

  it('远程返回 image/svg+xml 时在读取响应体之前被拒绝', async () => {
    mocks.fetch.mockResolvedValue(
      new Response(new Uint8Array([60, 115, 118, 103]), {
        status: 200,
        headers: { 'content-type': 'image/svg+xml; charset=utf-8' },
      }),
    );

    const error = await captureError(
      runLookAtTool({
        imageData: 'https://cdn.example.com/assets/logo.svg',
        goal: 'analyze svg',
        parentSessionId: 'parent',
        userId: 'user-1',
      }),
    );

    expect(error.message).toBe(SVG_UNSUPPORTED_MESSAGE);
    expect(mocks.readFile).not.toHaveBeenCalled();
    expectNoProviderWork();
  });

  it('PNG data URL 不受影响，仍正常调用上游', async () => {
    const result = await runLookAtTool({
      imageData: PNG_DATA_URL,
      goal: 'analyze png',
      parentSessionId: 'parent',
      userId: 'user-1',
    });

    expect(result).toBe('ok');
    expect(mocks.runUpstreamGenerate).toHaveBeenCalledTimes(1);
  });

  it('text/plain 文件不受影响，仍正常读取并调用上游', async () => {
    mocks.readFile.mockResolvedValue(Buffer.from('hello world') as never);

    const result = await runLookAtTool({
      filePath: '/tmp/workspace/notes.txt',
      goal: 'analyze text',
      parentSessionId: 'parent',
      userId: 'user-1',
    });

    expect(result).toBe('ok');
    expect(mocks.readFile).toHaveBeenCalledTimes(1);
    expect(mocks.runUpstreamGenerate).toHaveBeenCalledTimes(1);
  });
});
