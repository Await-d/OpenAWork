import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { ExecResult, SSHExecOptions, SSHToolProxy } from '@openAwork/agent-core';
import type { SshRemoteExecutionContext } from '../../tools/ssh-remote-execution.js';
import {
  resetSshWorkspaceFileIndexCacheForTest,
  searchSshWorkspaceFileIndex,
} from '../../workspace/ssh-workspace-file-index.js';
import {
  WORKSPACE_FILE_INDEX_CACHE_MAX_ENTRIES,
  WORKSPACE_FILE_INDEX_CACHE_TTL_MS,
  WORKSPACE_FILE_INDEX_DEFAULT_MAX_ENTRIES,
} from '../../workspace/workspace-file-index.js';

type ExecCommandMock = Mock<(command: string, options?: SSHExecOptions) => Promise<ExecResult>>;

function createExecResult(
  stdout: string,
  overrides: {
    exitCode?: number;
    timedOut?: boolean;
    stderr?: string;
    stdoutTruncated?: boolean;
  } = {},
): ExecResult {
  return {
    stdout,
    stderr: overrides.stderr ?? '',
    exitCode: overrides.exitCode ?? 0,
    ...(overrides.timedOut !== undefined ? { timedOut: overrides.timedOut } : {}),
    ...(overrides.stdoutTruncated !== undefined
      ? { stdoutTruncated: overrides.stdoutTruncated }
      : {}),
  };
}

function createExecCommandMock(
  implementation: (command: string, options?: SSHExecOptions) => Promise<ExecResult> = async () =>
    createExecResult('./src/App.tsx\n./src/utils/format.ts\n./README.md\n'),
): ExecCommandMock {
  return vi.fn<(command: string, options?: SSHExecOptions) => Promise<ExecResult>>(implementation);
}

function createContext(options: {
  connectionId?: string;
  baseDir?: string;
  execCommand?: ExecCommandMock;
}): { context: SshRemoteExecutionContext; execCommand: ExecCommandMock } {
  const execCommand = options.execCommand ?? createExecCommandMock();
  const proxy: SSHToolProxy = {
    execCommand,
    readFile: vi.fn(),
    readFileBytes: vi.fn(),
    writeFile: vi.fn(),
    listFiles: vi.fn(),
  };
  return {
    context: {
      sessionId: 'session-1',
      boundSessionId: 'session-1',
      connectionId: options.connectionId ?? 'conn-1',
      host: 'example.com',
      username: 'dev',
      port: 22,
      baseDir: options.baseDir ?? '/home/dev/project',
      proxy,
    },
    execCommand,
  };
}

beforeEach(() => {
  resetSshWorkspaceFileIndexCacheForTest();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('searchSshWorkspaceFileIndex', () => {
  it('冷启动执行一次远端 find，命中查询后返回相对路径', async () => {
    const { context, execCommand } = createContext({});

    const result = await searchSshWorkspaceFileIndex({ context, query: 'format', limit: 20 });

    expect(execCommand).toHaveBeenCalledTimes(1);
    const [command, options] = execCommand.mock.calls[0]!;
    expect(command).toContain("cd '/home/dev/project' && find .");
    expect(command).toContain("-name 'node_modules'");
    expect(command).toContain('-type f -print');
    expect(command).toContain(`head -n ${WORKSPACE_FILE_INDEX_DEFAULT_MAX_ENTRIES}`);
    expect(options?.timeoutMs).toBe(20_000);
    expect(result).toEqual({
      root: '/home/dev/project',
      files: ['src/utils/format.ts'],
      directories: [],
      truncated: false,
      count: 1,
    });
  });

  it('TTL 内重复检索复用缓存，不重复执行远端 find', async () => {
    const { context, execCommand } = createContext({});

    await searchSshWorkspaceFileIndex({ context, query: 'App', limit: 20 });
    const second = await searchSshWorkspaceFileIndex({ context, query: 'App', limit: 20 });

    expect(execCommand).toHaveBeenCalledTimes(1);
    expect(second.files).toEqual(['src/App.tsx']);
  });

  it('超过 TTL 后重新构建远端索引', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const { context, execCommand } = createContext({});

    await searchSshWorkspaceFileIndex({ context, query: 'App', limit: 20 });
    vi.advanceTimersByTime(WORKSPACE_FILE_INDEX_CACHE_TTL_MS);
    await searchSshWorkspaceFileIndex({ context, query: 'App', limit: 20 });

    expect(execCommand).toHaveBeenCalledTimes(2);
  });

  it('超过缓存容量后按 builtAt 淘汰最旧条目', async () => {
    const execCommand = createExecCommandMock(async () => createExecResult('./src/App.tsx\n'));
    const contexts: SshRemoteExecutionContext[] = [];
    for (let index = 0; index <= WORKSPACE_FILE_INDEX_CACHE_MAX_ENTRIES; index += 1) {
      const { context } = createContext({
        connectionId: `conn-${index}`,
        baseDir: `/home/dev/project-${index}`,
        execCommand,
      });
      contexts.push(context);
      await searchSshWorkspaceFileIndex({ context, query: 'App', limit: 20 });
    }
    expect(execCommand).toHaveBeenCalledTimes(WORKSPACE_FILE_INDEX_CACHE_MAX_ENTRIES + 1);

    // 最旧的 conn-0 已被淘汰：再次检索会重建（多一次调用）。
    await searchSshWorkspaceFileIndex({ context: contexts[0]!, query: 'App', limit: 20 });
    expect(execCommand).toHaveBeenCalledTimes(WORKSPACE_FILE_INDEX_CACHE_MAX_ENTRIES + 2);

    // 最新的 conn-N 仍在缓存：不再重建。
    await searchSshWorkspaceFileIndex({
      context: contexts[contexts.length - 1]!,
      query: 'App',
      limit: 20,
    });
    expect(execCommand).toHaveBeenCalledTimes(WORKSPACE_FILE_INDEX_CACHE_MAX_ENTRIES + 2);
  });

  it('远端 find 非零退出时返回空结果且不抛错', async () => {
    const execCommand = createExecCommandMock(async () =>
      createExecResult('', { exitCode: 1, stderr: 'find: no such directory' }),
    );
    const { context } = createContext({ execCommand });

    const result = await searchSshWorkspaceFileIndex({ context, query: 'App', limit: 20 });

    expect(result).toEqual({
      root: '/home/dev/project',
      files: [],
      directories: [],
      truncated: false,
      count: 0,
    });
  });

  it('远端 find 超时时返回空结果且不抛错', async () => {
    const execCommand = createExecCommandMock(async () =>
      createExecResult('', { exitCode: -1, timedOut: true }),
    );
    const { context } = createContext({ execCommand });

    const result = await searchSshWorkspaceFileIndex({ context, query: 'App', limit: 20 });

    expect(result.files).toEqual([]);
    expect(result.count).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('远端 execCommand 抛异常时返回空结果且不抛错', async () => {
    const execCommand = createExecCommandMock(async () => {
      throw new Error('SSH client not connected');
    });
    const { context } = createContext({ execCommand });

    await expect(
      searchSshWorkspaceFileIndex({ context, query: 'App', limit: 20 }),
    ).resolves.toEqual({
      root: '/home/dev/project',
      files: [],
      directories: [],
      truncated: false,
      count: 0,
    });
  });

  it('非 POSIX 远端工作目录直接返回空结果，不执行 find', async () => {
    const { context, execCommand } = createContext({ baseDir: 'C:\\Users\\dev\\project' });

    const result = await searchSshWorkspaceFileIndex({ context, query: 'App', limit: 20 });

    expect(execCommand).not.toHaveBeenCalled();
    expect(result).toEqual({
      root: 'C:\\Users\\dev\\project',
      files: [],
      directories: [],
      truncated: false,
      count: 0,
    });
  });

  it('解析 find 输出时容忍 \\r、空行并去掉 ./ 前缀', async () => {
    const execCommand = createExecCommandMock(async () =>
      createExecResult('./src/App.tsx\r\n\r\n./src/utils/format.ts\n./\n'),
    );
    const { context } = createContext({ execCommand });

    const result = await searchSshWorkspaceFileIndex({ context, query: 'a', limit: 50 });

    expect(result.files).toEqual(['src/App.tsx', 'src/utils/format.ts']);
  });

  it('条目数达到上限时标记 truncated', async () => {
    const lines = Array.from(
      { length: WORKSPACE_FILE_INDEX_DEFAULT_MAX_ENTRIES },
      (_unused, index) => `./f${index}.ts`,
    ).join('\n');
    const execCommand = createExecCommandMock(async () => createExecResult(lines));
    const { context } = createContext({ execCommand });

    const result = await searchSshWorkspaceFileIndex({ context, query: '', limit: 20 });

    expect(result.truncated).toBe(true);
  });

  it('冷缓存下并发检索只触发一次远端 find（进行中构建合并）', async () => {
    let resolveExec: ((result: ExecResult) => void) | undefined;
    const execCommand = createExecCommandMock(
      () =>
        new Promise<ExecResult>((resolve) => {
          resolveExec = resolve;
        }),
    );
    const { context } = createContext({ execCommand });

    const first = searchSshWorkspaceFileIndex({ context, query: 'App', limit: 20 });
    const second = searchSshWorkspaceFileIndex({ context, query: 'App', limit: 20 });

    // 两个请求都已进入构建路径，但远端 find 只应启动一次。
    expect(execCommand).toHaveBeenCalledTimes(1);
    resolveExec?.(createExecResult('./src/App.tsx\n'));

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.files).toEqual(['src/App.tsx']);
    expect(secondResult.files).toEqual(['src/App.tsx']);
    expect(execCommand).toHaveBeenCalledTimes(1);
  });

  it('stdout 被截断时标记 truncated，并丢弃尾部半行形成的伪条目', async () => {
    const execCommand = createExecCommandMock(async () =>
      createExecResult('./src/App.tsx\n./src/partial', { stdoutTruncated: true }),
    );
    const { context } = createContext({ execCommand });

    const result = await searchSshWorkspaceFileIndex({ context, query: 'src', limit: 20 });

    expect(result.truncated).toBe(true);
    expect(result.files).toEqual(['src/App.tsx']);
    expect(result.files).not.toContain('src/partial');
  });
});
