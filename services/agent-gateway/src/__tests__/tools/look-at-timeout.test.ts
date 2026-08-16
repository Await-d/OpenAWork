/**
 * Robustness: the multimodal `look_at` tool must enforce a wall-clock
 * deadline on its upstream call.
 *
 * `look_at` executes through the gateway-managed sandbox path
 * (`tool-sandbox.ts` returns `runLookAtTool(...)` directly), which
 * bypasses the ToolRegistry's own `timeout` + abort wrapper. The
 * underlying `runUpstreamGenerate` has no
 * built-in deadline, so without an internal timeout an upstream socket
 * that connects but never responds would leave the look_at call — and
 * the agent turn that issued it — pending forever.
 *
 * These tests go through the public `runLookAtTool` entry-point with an
 * inline `imageData` payload (no filesystem access) and assert it:
 *   1. forwards a real AbortSignal to runUpstreamGenerate, and
 *   2. aborts + throws a stable `look_at LLM timeout` error when the
 *      upstream never settles before the deadline.
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

function createRoute(overrides?: Partial<ModelRouteConfig>): ModelRouteConfig {
  return {
    model: overrides?.model ?? 'gpt-4o',
    apiBaseUrl: overrides?.apiBaseUrl ?? 'https://api.openai.com/v1',
    apiKey: overrides?.apiKey ?? 'sk-test',
    maxTokens: overrides?.maxTokens ?? 2048,
    temperature: overrides?.temperature ?? 0.2,
    upstreamProtocol: overrides?.upstreamProtocol ?? 'chat_completions',
    requestOverrides: overrides?.requestOverrides ?? {},
    supportsThinking: overrides?.supportsThinking ?? false,
    providerType: overrides?.providerType ?? 'openai',
  };
}

const SAMPLE_IMAGE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

describe('runLookAtTool — wall-clock timeout', () => {
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('forwards an AbortSignal to runUpstreamGenerate', async () => {
    mocks.runUpstreamGenerate.mockReturnValue(
      Effect.succeed({
        text: 'describes a pixel',
        inputTokens: 1,
        outputTokens: 1,
        finishReason: 'stop',
      }),
    );

    await runLookAtTool({
      imageData: SAMPLE_IMAGE_DATA_URL,
      goal: 'describe',
      parentSessionId: 'parent-session',
      userId: 'user-1',
    });

    const callArgs = mocks.runUpstreamGenerate.mock.calls[0]?.[0] as { signal?: AbortSignal };
    expect(callArgs.signal).toBeInstanceOf(AbortSignal);
    expect(callArgs.signal?.aborted).toBe(false);
  });

  it('aborts and throws a stable timeout error when upstream hangs', async () => {
    vi.useFakeTimers();

    let abortFired = false;
    mocks.runUpstreamGenerate.mockImplementation((arg: { signal?: AbortSignal }) =>
      Effect.callback<never, Error>((resume) => {
        const abort = () => {
          abortFired = true;
          resume(Effect.fail(new Error('aborted by signal')));
        };
        arg.signal?.addEventListener('abort', abort, { once: true });
        return Effect.sync(() => arg.signal?.removeEventListener('abort', abort));
      }),
    );

    const promise = runLookAtTool({
      imageData: SAMPLE_IMAGE_DATA_URL,
      goal: 'describe',
      parentSessionId: 'parent-session',
      userId: 'user-1',
    });
    const settled = promise.then(
      () => ({ ok: true as const }),
      (err: unknown) => ({ ok: false as const, err }),
    );

    // Default look_at deadline is 120s; advance just past it.
    await vi.advanceTimersByTimeAsync(120_000);

    const result = await settled;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.err as Error).message).toContain('look_at LLM timeout');
    }
    expect(abortFired).toBe(true);
  });
});
