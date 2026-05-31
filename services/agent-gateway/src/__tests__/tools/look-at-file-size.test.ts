/**
 * Robustness: `look_at`'s file branches each buffer the whole file before any
 * truncation — image as base64 (~1.33x), text fully read then sliced, PDF
 * fully buffered. The `file_path` is user-supplied, so without a size ceiling
 * a multi-GB workspace file would OOM the gateway. A `stat`-based guard now
 * rejects oversized files before a single byte is read.
 */

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
  stat: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  stat: mocks.stat,
  readFile: mocks.readFile,
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

describe('runLookAtTool — file size guard', () => {
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
    mocks.runUpstreamGenerate.mockResolvedValue({
      text: 'ok',
      inputTokens: 1,
      outputTokens: 1,
      finishReason: 'stop',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('超过大小上限的文件在读取前即被拒绝（不调用 readFile / 不打上游）', async () => {
    // 1 GB — well over the 64MB default ceiling.
    mocks.stat.mockResolvedValue({ size: 1024 * 1024 * 1024 } as never);

    await expect(
      runLookAtTool({
        filePath: '/tmp/workspace/huge.png',
        goal: 'describe',
        parentSessionId: 'parent',
        userId: 'user-1',
      }),
    ).rejects.toThrow(/look_at file too large/);

    expect(mocks.stat).toHaveBeenCalledTimes(1);
    // Guard fired before any read or upstream call.
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.runUpstreamGenerate).not.toHaveBeenCalled();
  });

  it('小于上限的图片文件正常读取并打上游', async () => {
    mocks.stat.mockResolvedValue({ size: 1024 } as never);
    mocks.readFile.mockResolvedValue(Buffer.from('fakeimagebytes').toString('base64') as never);

    const result = await runLookAtTool({
      filePath: '/tmp/workspace/small.png',
      goal: 'describe',
      parentSessionId: 'parent',
      userId: 'user-1',
    });

    expect(result).toBe('ok');
    expect(mocks.runUpstreamGenerate).toHaveBeenCalledTimes(1);
  });
});
