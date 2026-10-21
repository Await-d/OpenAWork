/**
 * 远端工具执行桥的出口文案回归。
 *
 * 背景（2026-10-15 排障包）：远端 sshd 未启用 sftp 时，`read` 把 ssh2 的英文裸串
 * 直接透传给模型，模型据此在毫无指引的情况下反复重试；远端 bash 又因 sshd 起的是
 * 非登录、非交互 shell（PATH 缺 /usr/local/bin）而 `docker: command not found`。
 * 这两类失败都必须在工具出口给出可操作提示 —— 同时不得吞掉真实的远端故障。
 */
import { describe, expect, it } from 'vitest';
import { SshSftpUnavailableError } from '@openAwork/agent-core';
import type { ExecResult, SSHToolProxy } from '@openAwork/agent-core';
import type { BashExecutionResult } from '../../tools/bash-tools.js';
import {
  buildRemoteCommandNotFoundHint,
  buildRemoteWorkdirMissingHint,
  executeSshRemoteTool,
  formatSshSftpUnavailableToolMessage,
} from '../../tools/ssh-remote-execution.js';
import type { SshRemoteExecutionContext } from '../../tools/ssh-remote-execution.js';

function createProxy(overrides: Partial<SSHToolProxy> = {}): SSHToolProxy {
  return {
    execCommand: async (): Promise<ExecResult> => ({ stdout: '', stderr: '', exitCode: 0 }),
    readFile: async () => ({
      path: '/tmp/probe',
      content: '',
      encoding: 'utf8',
      truncated: false,
    }),
    readFileBytes: async () => ({
      data: Buffer.alloc(0),
      size: 0,
      truncated: false,
      isDirectory: false,
    }),
    writeFile: async () => undefined,
    listFiles: async () => [],
    ...overrides,
  };
}

function createContext(proxy: SSHToolProxy): SshRemoteExecutionContext {
  return {
    sessionId: 'sess-1',
    boundSessionId: 'sess-1',
    connectionId: 'conn-1',
    host: '192.168.123.5',
    username: 'await',
    port: 2719,
    baseDir: '/home/await',
    proxy,
  };
}

async function runTool(toolName: string, rawInput: Record<string, unknown>, proxy: SSHToolProxy) {
  return executeSshRemoteTool({
    request: { toolCallId: `call_${toolName}`, toolName, rawInput },
    sessionId: 'sess-1',
    context: createContext(proxy),
  });
}

/** 让 SFTP 类调用一律失败，模拟远端 sshd 未启用 sftp 子系统。 */
function createSftpFailingProxy(error: Error): SSHToolProxy {
  return createProxy({
    readFile: async () => {
      throw error;
    },
    listFiles: async () => {
      throw error;
    },
  });
}

describe('executeSshRemoteTool：远端未启用 sftp 子系统', () => {
  it('read 返回可操作中文提示，而不是 ssh2 的英文裸串', async () => {
    const result = await runTool(
      'read',
      { path: '/etc/hosts' },
      createSftpFailingProxy(new SshSftpUnavailableError()),
    );

    expect(result?.isError).toBe(true);
    const output = String(result?.output);
    expect(output).toContain('远端服务器未启用 SFTP 子系统');
    expect(output).toContain('Subsystem sftp');
    expect(output).toContain('改用 bash');
    expect(output).not.toContain('did not start the sftp subsystem');
  });

  it('未归一的 ssh2 裸文案同样被识别（注入实现 / 旧链路）', async () => {
    const result = await runTool(
      'read',
      { path: '/etc/hosts' },
      createSftpFailingProxy(new Error('Unable to start subsystem: sftp')),
    );

    expect(String(result?.output)).toContain('远端服务器未启用 SFTP 子系统');
  });

  it('其它远端错误原样透传，不掩盖真实故障', async () => {
    const result = await runTool(
      'read',
      { path: '/etc/hosts' },
      createSftpFailingProxy(new Error('SSH SFTP read timed out')),
    );

    expect(result?.isError).toBe(true);
    expect(String(result?.output)).toContain('SSH SFTP read timed out');
    expect(String(result?.output)).not.toContain('Subsystem sftp');
  });

  it('提示点名依赖 SFTP 的工具，并说明重试无效', async () => {
    const message = formatSshSftpUnavailableToolMessage('read');

    expect(message).toContain('read / write / edit / multi_edit / list');
    expect(message).toContain('重试不会恢复');
  });
});

describe('executeSshRemoteTool：远端 bash 的 PATH 提示', () => {
  it('exit 127 时在 bash_metadata 里补 PATH 提示', async () => {
    const proxy = createProxy({
      execCommand: async () => ({
        stdout: '=== docker ps ===\n',
        stderr: 'sh: docker: command not found\n',
        exitCode: 127,
      }),
    });

    const result = await runTool('bash', { command: 'docker ps' }, proxy);

    expect(result?.isError).toBe(true);
    const execution = result?.output as BashExecutionResult;
    expect(execution.exitCode).toBe(127);
    expect(execution.output).toContain('<bash_metadata>');
    expect(execution.output).toContain('command not found');
    expect(execution.output).toContain('/usr/local/bin');
  });

  it('成功命令不追加 PATH 提示', async () => {
    const proxy = createProxy({
      execCommand: async () => ({ stdout: 'ok\n', stderr: '', exitCode: 0 }),
    });

    const result = await runTool('bash', { command: 'ls' }, proxy);

    expect(result?.isError).toBe(false);
    const execution = result?.output as BashExecutionResult;
    expect(execution.output).toContain('[ssh] executed on await@192.168.123.5:2719');
    expect(execution.output).not.toContain('/usr/local/bin');
  });
});

describe('buildRemoteCommandNotFoundHint', () => {
  it('退出码 127 或输出含 command not found 时给出提示', () => {
    expect(buildRemoteCommandNotFoundHint({ exitCode: 127, output: '' })).toContain(
      '/usr/local/bin',
    );
    expect(
      buildRemoteCommandNotFoundHint({ exitCode: 1, output: 'sh: docker: command not found' }),
    ).toContain('PATH');
  });

  it('其它失败不误报', () => {
    expect(buildRemoteCommandNotFoundHint({ exitCode: 1, output: 'grep: no match' })).toBeNull();
    expect(buildRemoteCommandNotFoundHint({ exitCode: 0, output: '' })).toBeNull();
  });
});

/**
 * 回归（2026-10-16 排障包）：远端命令是 `cd <workdir> && <cmd>`，workdir 不存在时
 * 命令体一行都没跑，输出只有 `cd: <path>: No such file or directory`。模型容易误判成
 * 「目录内容有问题」而反复调整命令，故在出口补提示（本地 bash 有 stat 预检，远端没有）。
 */
describe('buildRemoteWorkdirMissingHint', () => {
  const cdFailure = {
    command: "cd '/volume1/docker/app' && docker ps",
    workdir: '/volume1/docker/app',
    output: 'sh: line 0: cd: /volume1/docker/app: No such file or directory\n',
  };

  it('cd 因 workdir 不存在而失败时给出提示', () => {
    const hint = buildRemoteWorkdirMissingHint(cdFailure);

    expect(hint).toContain('/volume1/docker/app');
    expect(hint).toContain('不存在');
    expect(hint).toContain('mkdir -p');
  });

  it('命令体自身的 No such file 不误报', () => {
    expect(
      buildRemoteWorkdirMissingHint({
        ...cdFailure,
        output: 'cat: /etc/missing.conf: No such file or directory\n',
      }),
    ).toBeNull();
  });

  it('非 cd 前缀的命令不误报', () => {
    expect(
      buildRemoteWorkdirMissingHint({
        ...cdFailure,
        command: "ls '/volume1/docker/app'",
      }),
    ).toBeNull();
  });

  it('workdir 之外的 cd 失败不误报（命令体内部自己 cd 失败）', () => {
    expect(
      buildRemoteWorkdirMissingHint({
        ...cdFailure,
        output: 'cd: /other/place: No such file or directory\n',
      }),
    ).toBeNull();
  });
});
