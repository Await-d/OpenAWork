import type * as AgentCore from '@openAwork/agent-core';
import type * as NodeFs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `ensureIgnoreRulesLoadedForPath` 的缓存语义回归。
 *
 * 关键缺陷:一次 `loadRules` 失败若把 rejected Promise 留在缓存里,该 workspace 根下
 * 所有后续 `/workspace/tree` 请求都会复现同一 rejection 而持续 500,直到网关重启。
 * 这里锁定「失败必须清除缓存、成功必须按根缓存」两条不变量。
 */

const mocks = vi.hoisted(() => ({
  ignoreManager: { loadRules: vi.fn() },
  resolveGatewayDataDir: vi.fn(() => '/gateway/data/agent-gateway'),
  sqliteGet: vi.fn(),
}));

vi.mock('@openAwork/agent-core', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentCore>();
  return { ...actual, defaultIgnoreManager: mocks.ignoreManager };
});

vi.mock('@openAwork/platform-adapter', () => ({
  createPlatformAdapter: () => ({
    getPlatform: () => 'linux',
    getDocumentsDir: () => '/home/tester/Documents',
  }),
}));

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeFs>()),
  mkdirSync: vi.fn(),
}));

vi.mock('../../infra/storage-paths.js', () => ({
  resolveGatewayDataDir: mocks.resolveGatewayDataDir,
}));

vi.mock('../../infra/db.js', () => ({
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_ROOT: '/',
  WORKSPACE_ROOTS: ['/'],
  sqliteGet: mocks.sqliteGet,
}));

vi.mock('../../session/session-workspace-resolution.js', () => ({
  resolveSessionWorkspacePath: vi.fn(() => null),
}));

vi.mock('../../session/session-workspace-metadata.js', () => ({
  parseSessionMetadataJson: vi.fn(() => ({})),
}));

const WORKSPACE_ROOT = '/root';

async function loadModule(): Promise<{
  ensureIgnoreRulesLoadedForPath: (path?: string | null) => Promise<void>;
}> {
  return import('../../workspace/workspace-safety.js');
}

describe('ensureIgnoreRulesLoadedForPath 缓存', () => {
  beforeEach(() => {
    // 每个用例都要拿到全新的模块级缓存/全局标记。
    vi.resetModules();
    mocks.ignoreManager.loadRules.mockReset();
    mocks.sqliteGet.mockReset();
  });

  it('loadRules 失败后清除缓存,下一次调用重新加载而不是复现失败', async () => {
    const loadRules = mocks.ignoreManager.loadRules;
    loadRules.mockRejectedValueOnce(new Error('ignore load boom')).mockResolvedValueOnce(undefined);

    const { ensureIgnoreRulesLoadedForPath } = await loadModule();

    await expect(ensureIgnoreRulesLoadedForPath(WORKSPACE_ROOT)).rejects.toThrow(
      'ignore load boom',
    );
    await expect(ensureIgnoreRulesLoadedForPath(WORKSPACE_ROOT)).resolves.toBeUndefined();

    expect(loadRules).toHaveBeenCalledTimes(2);
  });

  it('成功加载后同一根只加载一次', async () => {
    const loadRules = mocks.ignoreManager.loadRules;
    loadRules.mockResolvedValue(undefined);

    const { ensureIgnoreRulesLoadedForPath } = await loadModule();
    await ensureIgnoreRulesLoadedForPath(WORKSPACE_ROOT);
    await ensureIgnoreRulesLoadedForPath(WORKSPACE_ROOT);

    expect(loadRules).toHaveBeenCalledTimes(1);
  });

  it('并发同根请求共享同一次在途加载', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const loadRules = mocks.ignoreManager.loadRules;
    loadRules.mockReturnValue(gate);

    const { ensureIgnoreRulesLoadedForPath } = await loadModule();
    const first = ensureIgnoreRulesLoadedForPath(WORKSPACE_ROOT);
    const second = ensureIgnoreRulesLoadedForPath(WORKSPACE_ROOT);
    release();
    await Promise.all([first, second]);

    expect(loadRules).toHaveBeenCalledTimes(1);
  });
});
