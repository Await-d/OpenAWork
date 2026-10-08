/**
 * SSH 远端工作区的写操作与检索路由。
 *
 * 覆盖 `workspace-ssh-routes.ts` 新补齐的接口：这些路由此前都只有本地实现，
 * 在「网关运行于 Windows + 会话绑定远端 POSIX 工作区」时会先撞上
 * `assertWorkspacePathSupportedByCurrentHost` 的 400，功能完全不可用。
 *
 * 本文件不构造真实 SSH 连接，而是直接对 `handleSshWorkspaceOp` 的分发与
 * shell 转义做单元验证：真实 SSH 链路由既有集成测试覆盖，这里锁定的是
 * 「新增 op 是否正确接线」与「远端命令是否被安全转义」。
 */
import { execFileSync } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveSshPreviewContext: vi.fn(),
  resolveRemotePath: vi.fn((_context: unknown, path: string) => path),
  isRemotePathWithinRoot: vi.fn(() => true),
  classifySshPreviewError: vi.fn((error: unknown) => {
    const err = error as { statusCode?: number; message?: string };
    return { statusCode: err.statusCode ?? 500, message: err.message ?? 'unknown' };
  }),
  readRemoteTextFile: vi.fn(),
  readRemoteBinaryFile: vi.fn(),
  readRemoteDirectoryTree: vi.fn(),
  gateAcquire: vi.fn(async () => ({ ok: true, release: vi.fn() })),
  proxy: {
    execCommand: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
    writeFile: vi.fn(async () => undefined),
    listFiles: vi.fn(async () => []),
    readFileBytes: vi.fn(),
    readFile: vi.fn(),
  },
}));

vi.mock('../../tools/ssh-remote-execution.js', () => ({
  resolveRemotePath: mocks.resolveRemotePath,
}));

vi.mock('../../workspace/ssh-workspace-preview.js', () => ({
  resolveSshPreviewContext: mocks.resolveSshPreviewContext,
  classifySshPreviewError: mocks.classifySshPreviewError,
  isRemotePathWithinRoot: mocks.isRemotePathWithinRoot,
  readRemoteTextFile: mocks.readRemoteTextFile,
  readRemoteBinaryFile: mocks.readRemoteBinaryFile,
  readRemoteDirectoryTree: mocks.readRemoteDirectoryTree,
  SshPreviewError: class extends Error {
    override readonly name = 'SshPreviewError';
    constructor(
      readonly statusCode: number,
      message: string,
    ) {
      super(message);
    }
  },
}));

vi.mock('../../workspace/preview-concurrency-gate.js', () => ({
  createPreviewConcurrencyGate: () => ({ acquire: mocks.gateAcquire }),
}));

const READY_CONTEXT = {
  baseDir: '/home/await/project/demo',
  proxy: mocks.proxy,
  connectionId: 'conn-1',
  host: 'dev',
  username: 'await',
  port: 22,
  sessionId: 'sess-1',
  boundSessionId: 'sess-1',
};

/** 最小 reply 桩：记录 status/send，供断言回包语义。 */
function makeReply() {
  const state = { status: 0, body: undefined as unknown, headers: {} as Record<string, string> };
  const reply = {
    status(code: number) {
      state.status = code;
      return reply;
    },
    header(key: string, value: string) {
      state.headers[key] = value;
      return reply;
    },
    send(body: unknown) {
      state.body = body;
      return reply;
    },
  };
  return { reply, state };
}

async function loadModule() {
  return import('../../workspace/workspace-ssh-routes.js');
}

beforeEach(() => {
  // 「未执行远端命令」这类断言依赖干净的调用记录，必须逐用例清空。
  vi.clearAllMocks();
  mocks.isRemotePathWithinRoot.mockReturnValue(true);
  mocks.proxy.execCommand.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
});

describe('handleSshWorkspaceOp 分发', () => {
  it('未绑定 SSH（local）时不回包，把决定权交回调用方', async () => {
    mocks.resolveSshPreviewContext.mockResolvedValue({ kind: 'local' });
    const { handleSshWorkspaceOp } = await loadModule();
    const { reply, state } = makeReply();

    const outcome = await handleSshWorkspaceOp({
      reply: reply as never,
      user: 'u1',
      op: 'validate',
      identity: { sessionId: 'sess-1' },
      path: '/home/await/project/demo',
    });

    expect(outcome).toEqual({ kind: 'local' });
    expect(state.status).toBe(0);
    expect(state.body).toBeUndefined();
  });

  it('路径越界时 403，且不执行任何远端命令', async () => {
    mocks.resolveSshPreviewContext.mockResolvedValue({ kind: 'ready', context: READY_CONTEXT });
    mocks.isRemotePathWithinRoot.mockReturnValue(false);
    const { handleSshWorkspaceOp } = await loadModule();
    const { reply, state } = makeReply();

    const outcome = await handleSshWorkspaceOp({
      reply: reply as never,
      user: 'u1',
      op: 'deleteEntry',
      identity: { sessionId: 'sess-1' },
      path: '/etc/passwd',
    });

    expect(outcome).toEqual({ kind: 'handled' });
    expect(state.status).toBe(403);
    expect(mocks.proxy.execCommand).not.toHaveBeenCalled();
  });

  it('writeFile 走远端 writeFile 而不是本地 fs', async () => {
    mocks.resolveSshPreviewContext.mockResolvedValue({ kind: 'ready', context: READY_CONTEXT });
    mocks.isRemotePathWithinRoot.mockReturnValue(true);
    const { handleSshWorkspaceOp } = await loadModule();
    const { reply, state } = makeReply();

    const outcome = await handleSshWorkspaceOp({
      reply: reply as never,
      user: 'u1',
      op: 'writeFile',
      identity: { sessionId: 'sess-1' },
      path: '/home/await/project/demo/a.ts',
      content: 'export const a = 1;',
    });

    expect(outcome).toEqual({ kind: 'handled' });
    expect(state.status).toBe(200);
    expect(mocks.proxy.writeFile).toHaveBeenCalledWith(
      '/home/await/project/demo/a.ts',
      'export const a = 1;',
    );
  });

  it('创建语义（mustNotExist）遇到已存在文件返回 409，不覆盖', async () => {
    mocks.resolveSshPreviewContext.mockResolvedValue({ kind: 'ready', context: READY_CONTEXT });
    mocks.isRemotePathWithinRoot.mockReturnValue(true);
    mocks.proxy.execCommand.mockResolvedValue({
      stdout: '__OATW_EXISTS__',
      stderr: '',
      exitCode: 0,
    });
    const { handleSshWorkspaceOp } = await loadModule();
    const { reply, state } = makeReply();

    const outcome = await handleSshWorkspaceOp({
      reply: reply as never,
      user: 'u1',
      op: 'writeFile',
      identity: { sessionId: 'sess-1' },
      path: '/home/await/project/demo/a.ts',
      content: 'x',
      mustNotExist: true,
    });

    expect(outcome).toEqual({ kind: 'handled' });
    expect(state.status).toBe(409);
    expect(mocks.proxy.writeFile).not.toHaveBeenCalled();
  });

  it('createDirectory 用 mkdir -p', async () => {
    mocks.resolveSshPreviewContext.mockResolvedValue({ kind: 'ready', context: READY_CONTEXT });
    mocks.isRemotePathWithinRoot.mockReturnValue(true);
    mocks.proxy.execCommand.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
    const { handleSshWorkspaceOp } = await loadModule();
    const { reply, state } = makeReply();

    await handleSshWorkspaceOp({
      reply: reply as never,
      user: 'u1',
      op: 'createDirectory',
      identity: { sessionId: 'sess-1' },
      path: '/home/await/project/demo/src',
    });

    expect(state.status).toBe(200);
    expect(mocks.proxy.execCommand).toHaveBeenCalledWith("mkdir -p '/home/await/project/demo/src'");
  });

  it('deleteEntry 对不存在路径返回 404 而非静默成功', async () => {
    mocks.resolveSshPreviewContext.mockResolvedValue({ kind: 'ready', context: READY_CONTEXT });
    mocks.isRemotePathWithinRoot.mockReturnValue(true);
    mocks.proxy.execCommand.mockResolvedValue({
      stdout: '__OATW_MISSING__',
      stderr: '',
      exitCode: 0,
    });
    const { handleSshWorkspaceOp } = await loadModule();
    const { reply, state } = makeReply();

    await handleSshWorkspaceOp({
      reply: reply as never,
      user: 'u1',
      op: 'deleteEntry',
      identity: { sessionId: 'sess-1' },
      path: '/home/await/project/demo/gone.ts',
    });

    expect(state.status).toBe(404);
  });

  it('renameEntry 校验目标路径也在远端根内', async () => {
    mocks.resolveSshPreviewContext.mockResolvedValue({ kind: 'ready', context: READY_CONTEXT });
    mocks.isRemotePathWithinRoot.mockReturnValueOnce(true).mockReturnValueOnce(false);
    const { handleSshWorkspaceOp } = await loadModule();
    const { reply, state } = makeReply();

    await handleSshWorkspaceOp({
      reply: reply as never,
      user: 'u1',
      op: 'renameEntry',
      identity: { sessionId: 'sess-1' },
      path: '/home/await/project/demo/a.ts',
      newPath: '/etc/passwd',
    });

    expect(state.status).toBe(403);
    expect(mocks.proxy.execCommand).not.toHaveBeenCalled();
  });

  it('validate 用远端 test -d 区分目录与文件', async () => {
    mocks.resolveSshPreviewContext.mockResolvedValue({ kind: 'ready', context: READY_CONTEXT });
    mocks.isRemotePathWithinRoot.mockReturnValue(true);
    mocks.proxy.execCommand.mockResolvedValue({
      stdout: '__OATW_DIR__',
      stderr: '',
      exitCode: 0,
    });
    const { handleSshWorkspaceOp } = await loadModule();
    const { reply, state } = makeReply();

    await handleSshWorkspaceOp({
      reply: reply as never,
      user: 'u1',
      op: 'validate',
      identity: { sessionId: 'sess-1' },
      path: '/home/await/project/demo/src',
    });

    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ valid: true, isDirectory: true });
  });

  it('validate 对远端不存在的路径返回 valid:false 而非 404', async () => {
    mocks.resolveSshPreviewContext.mockResolvedValue({ kind: 'ready', context: READY_CONTEXT });
    mocks.isRemotePathWithinRoot.mockReturnValue(true);
    mocks.proxy.execCommand.mockResolvedValue({
      stdout: '__OATW_MISSING__',
      stderr: '',
      exitCode: 0,
    });
    const { handleSshWorkspaceOp } = await loadModule();
    const { reply, state } = makeReply();

    await handleSshWorkspaceOp({
      reply: reply as never,
      user: 'u1',
      op: 'validate',
      identity: { sessionId: 'sess-1' },
      path: '/home/await/project/demo/nope',
    });

    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ valid: false });
  });

  it('SSH 身份解析失败按其状态码回包，不落成 500', async () => {
    mocks.resolveSshPreviewContext.mockRejectedValue(
      Object.assign(new Error('SSH 连接不存在或无权访问。'), { statusCode: 400 }),
    );
    const { handleSshWorkspaceOp } = await loadModule();
    const { reply, state } = makeReply();

    await handleSshWorkspaceOp({
      reply: reply as never,
      user: 'u1',
      op: 'tree',
      identity: { sshConnectionId: 'conn-x' },
      path: '/home/await/project/demo',
      depth: 2,
    });

    expect(state.status).toBe(400);
  });
});

describe('远端命令的 shell 转义', () => {
  it('路径中的单引号被转义，shell 把 payload 当字面量而非命令', async () => {
    mocks.resolveSshPreviewContext.mockResolvedValue({ kind: 'ready', context: READY_CONTEXT });
    mocks.isRemotePathWithinRoot.mockReturnValue(true);
    mocks.proxy.execCommand.mockResolvedValue({ stdout: '__OATW_OK__', stderr: '', exitCode: 0 });
    const { handleSshWorkspaceOp } = await loadModule();
    const { reply } = makeReply();

    // 恶意路径：闭合引号后追加命令
    const maliciousPath = "/home/await/demo'; rm -rf ~; echo '";
    await handleSshWorkspaceOp({
      reply: reply as never,
      user: 'u1',
      op: 'createDirectory',
      identity: { sessionId: 'sess-1' },
      path: maliciousPath,
    });

    const command = readLastExecCommand();
    expect(command.startsWith('mkdir -p ')).toBe(true);

    // 用真实 shell 验证，而不是靠字符串正则：`printf '%s' <quoted>` 若被正确
    // 转义，输出必须与原路径逐字节相同 —— 这直接证明 shell 始终处于引号上下文内、
    // 没有执行 `rm -rf ~`。字符串断言无法区分「已转义」与「恰好含有同样子串」。
    const printed = execFileSync('sh', ['-c', `printf '%s' ${extractQuoted(command)}`], {
      encoding: 'utf8',
    });
    expect(printed).toBe(maliciousPath);
  });

  /** 从 `mkdir -p '<path>'` 中取出被引用的路径片段。 */
  function extractQuoted(command: string): string {
    const start = command.indexOf("'");
    const end = command.lastIndexOf("'");
    return command.slice(start, end + 1);
  }

  /** 读取最近一次远端命令。`vi.clearAllMocks()` 会清空调用记录的类型信息，故断言在读取处显式收敛。 */
  function readLastExecCommand(): string {
    const calls = mocks.proxy.execCommand.mock.calls as unknown as Array<[string]>;
    const last = calls.at(-1);
    if (!last) {
      throw new Error('预期远端命令被调用一次，但没有记录');
    }
    return last[0];
  }
});

describe('sshIdentityFrom', () => {
  it('透传三个身份字段，缺省为 undefined', async () => {
    const { sshIdentityFrom } = await loadModule();

    expect(sshIdentityFrom({ sessionId: 's', sshConnectionId: 'c', workspaceRoot: '/w' })).toEqual({
      sessionId: 's',
      sshConnectionId: 'c',
      workspaceRoot: '/w',
    });

    expect(sshIdentityFrom({})).toEqual({
      sessionId: undefined,
      sshConnectionId: undefined,
      workspaceRoot: undefined,
    });
  });
});
