/**
 * Regression: `runLookAtTool` must resolve `artifact:<id>` image references in
 * `image_data` to the artifact's real media type + bytes.
 *
 * Prior to the fix, an `artifact:<uuid>` value fell through to the inline-image
 * branch, where `inferMimeType` returned `application/octet-stream`; the tool
 * then fabricated a bogus `data:application/octet-stream;base64,artifact:<uuid>`
 * and the upstream provider rejected the call with
 * `OpenAI Responses does not support media type application/octet-stream`.
 *
 * These tests go through the public `runLookAtTool` entry-point with the
 * artifact store mocked, so no real DB is required.
 */

import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelRouteConfig } from '../../provider/model-router.js';

const mocks = vi.hoisted(() => ({
  runUpstreamGenerate: vi.fn(),
  sqliteGet: vi.fn(),
  sqliteRun: vi.fn(),
  listManagedAgentsForUser: vi.fn(() => [] as unknown[]),
  selectDelegatedModelForUser: vi.fn(() => null),
  getReferenceAgentModelEntries: vi.fn(() => [] as unknown[]),
  getProviderConfigForSelection: vi.fn(async () => null),
  resolveModelRoute: vi.fn(),
  resolveModelRouteFromProvider: vi.fn(),
  appendSessionMessageV2: vi.fn(),
  validateWorkspacePath: vi.fn((p: string) => p),
  getArtifactById: vi.fn(),
}));

vi.mock('../../infra/db.js', () => ({
  sqliteGet: mocks.sqliteGet,
  sqliteRun: mocks.sqliteRun,
  WORKSPACE_ROOT: '/tmp/workspace',
  WORKSPACE_ROOTS: ['/tmp/workspace'],
  WORKSPACE_ACCESS_MODE: 'unrestricted' as const,
  WORKSPACE_ACCESS_RESTRICTED: false,
}));

vi.mock('../../session/artifact-content-store.js', () => ({
  getArtifactById: mocks.getArtifactById,
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

// 1×1 transparent PNG, base64 — small enough to keep the test cheap.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`;

describe('runLookAtTool — artifact image source', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => {
      if (typeof m === 'function' && 'mockReset' in m) {
        (m as ReturnType<typeof vi.fn>).mockReset();
      }
    });
    mocks.listManagedAgentsForUser.mockReturnValue([]);
    mocks.selectDelegatedModelForUser.mockReturnValue(null);
    mocks.getReferenceAgentModelEntries.mockReturnValue([]);
    mocks.getProviderConfigForSelection.mockResolvedValue(null);
    mocks.validateWorkspacePath.mockImplementation((p: string) => p);
    mocks.resolveModelRoute.mockReturnValue(createRoute());
    mocks.runUpstreamGenerate.mockReturnValue(
      Effect.succeed({
        text: 'ok',
        inputTokens: 0,
        outputTokens: 0,
        finishReason: 'stop',
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves artifact:<id> to the real MIME and never sends octet-stream upstream', async () => {
    mocks.getArtifactById.mockReturnValue({
      id: 'artifact-1',
      content: TINY_PNG_DATA_URL,
    });

    await runLookAtTool({
      imageData: 'artifact:artifact-1',
      goal: 'describe the artifact image',
      parentSessionId: 'parent-session',
      userId: 'user-1',
    });

    expect(mocks.getArtifactById).toHaveBeenCalledWith('user-1', 'artifact-1');
    expect(mocks.runUpstreamGenerate).toHaveBeenCalledTimes(1);

    const callArgs = mocks.runUpstreamGenerate.mock.calls[0]?.[0] as
      { messages?: Array<{ content?: unknown }> } | undefined;
    const mediaPart = (callArgs?.messages?.[0]?.content as Array<Record<string, unknown>>).find(
      (part) => part['type'] === 'media',
    );
    expect(mediaPart).toMatchObject({
      data: TINY_PNG_DATA_URL,
      mediaType: 'image/png',
    });
    expect(mediaPart?.['mediaType']).not.toBe('application/octet-stream');
  });

  it('rejects an unrecognized image_data source before any upstream call', async () => {
    await expect(
      runLookAtTool({
        imageData: 'plain-text-not-an-image',
        goal: 'describe',
        parentSessionId: 'parent-session',
        userId: 'user-1',
      }),
    ).rejects.toThrow(/application\/octet-stream/);

    expect(mocks.runUpstreamGenerate).not.toHaveBeenCalled();
  });

  it('fails with a clear Chinese error when the artifact id does not exist', async () => {
    mocks.getArtifactById.mockReturnValue(undefined);

    await expect(
      runLookAtTool({
        imageData: 'artifact:missing-artifact',
        goal: 'describe',
        parentSessionId: 'parent-session',
        userId: 'user-1',
      }),
    ).rejects.toThrow('找不到 artifact: missing-artifact');

    expect(mocks.runUpstreamGenerate).not.toHaveBeenCalled();
  });
});
