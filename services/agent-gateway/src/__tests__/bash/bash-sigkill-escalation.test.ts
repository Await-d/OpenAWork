/**
 * 回归：bash 工具超时/中止后必须真正升级 SIGKILL。
 *
 * 旧实现用 `exited`（结果已结算）作为升级判据，而超时路径会先结算结果，
 * 导致 3 秒后的 SIGKILL 回调永远跳过；忽略 SIGTERM 的命令会一直留在后台。
 */
import type * as NodeChildProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();
const realSetTimeout = globalThis.setTimeout;

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeChildProcess>();
  return {
    ...actual,
    spawn: spawnMock,
  };
});

// 快照会调用 git；这里直接返回空变更，避免测试依赖工作区是否 git 仓库。
vi.mock('../../workspace/workspace-review.js', () => ({
  listWorkspaceReviewChanges: vi.fn(async () => []),
}));

vi.mock('../../infra/db.js', () => ({
  WORKSPACE_ROOT: tmpdir(),
  WORKSPACE_ROOTS: [tmpdir()],
  WORKSPACE_ACCESS_MODE: 'unrestricted' as const,
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_BROWSER_ROOT: '/',
  sqliteAll: vi.fn(() => []),
  sqliteGet: vi.fn(() => undefined),
  sqliteRun: vi.fn(),
  sqliteTransaction: vi.fn((fn: () => unknown) => fn()),
}));

const { runBashCommand } = await import('../../tools/bash-tools.js');

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly pid = 987_654;
  readonly killSignals: NodeJS.Signals[] = [];

  kill(signal: NodeJS.Signals): boolean {
    this.killSignals.push(signal);
    // 模拟忽略 SIGTERM、只在 SIGKILL 时才真正结束的进程。
    if (signal === 'SIGKILL') {
      this.emit('close', null, signal);
    }
    return true;
  }
}

async function waitForSpawn(): Promise<void> {
  for (let index = 0; index < 200; index += 1) {
    if (spawnMock.mock.calls.length > 0) return;
    // 用真实定时器：此处全局 setTimeout 已被 fake timers 替换。
    await new Promise<void>((resolve) => realSetTimeout(resolve, 5));
  }
  throw new Error('spawn was never called');
}

// Windows 走 taskkill /f，不经过 POSIX signal 分支；本测试只覆盖 POSIX 语义。
describe.skipIf(process.platform === 'win32')('bash SIGKILL escalation', () => {
  let workdir: string;

  beforeAll(async () => {
    workdir = await mkdtemp(path.join(tmpdir(), 'openAwork-bash-sigkill-'));
  });

  afterAll(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    spawnMock.mockReset();
    // 走 child.kill 回退分支，避免测试真的向进程组发信号。
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('ESRCH');
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('结果已结算后仍在宽限期结束时升级 SIGKILL', async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);

    const promise = runBashCommand(
      {
        command: 'sleep 60',
        description: 'stuck command',
        timeout: 100,
      },
      {
        preflight: {
          cwd: workdir,
          shellChoice: { shell: '/bin/bash', isPowerShell: false, name: 'bash' },
        },
      },
    );

    await waitForSpawn();
    await vi.advanceTimersByTimeAsync(100);

    const result = await promise;
    expect(result.kind).toBe('timeout');
    expect(result.exitCode).toBe(124);
    expect(child.killSignals).toEqual(['SIGTERM']);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(child.killSignals).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('进程在宽限期内正常退出时不再补发 SIGKILL', async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);

    const promise = runBashCommand(
      {
        command: 'sleep 60',
        description: 'stuck command',
        timeout: 100,
      },
      {
        preflight: {
          cwd: workdir,
          shellChoice: { shell: '/bin/bash', isPowerShell: false, name: 'bash' },
        },
      },
    );

    await waitForSpawn();
    await vi.advanceTimersByTimeAsync(100);
    await promise;

    // SIGTERM 之后进程自己退出了，close 应取消升级计时器。
    child.emit('close', null, 'SIGTERM');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(child.killSignals).toEqual(['SIGTERM']);
  });
});
