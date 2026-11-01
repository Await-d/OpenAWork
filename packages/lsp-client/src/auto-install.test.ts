import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LSPServerInfo } from './types.js';

/**
 * LSP 自动安装的阻塞/去重/冷却回归。
 *
 * 背景：线上反复出现 `event-loop-lag` 告警，最长一次 32.8 秒，同期网关完全不处理
 * 任何请求。根因是 `ensureInstalled` 用 `execSync` 跑 `npm install -g
 * typescript-language-server`——容器重建后全局语言服务丢失，第一条涉及 .ts 的请求
 * 就在**请求路径上**同步安装，把整条事件循环按住。容器内 `/root/.npm/_logs` 的
 * 时间戳与告警逐条吻合（3s / 32.8s / 17.1s）。
 */

const execMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({ exec: execMock }));

const MISSING_BINARY = 'openawork-definitely-missing-language-server';

function fakeServer(overrides: Partial<LSPServerInfo> = {}): LSPServerInfo {
  return {
    id: 'fake-ts',
    extensions: ['.ts'],
    binary: MISSING_BINARY,
    installCommand: 'npm install -g fake-language-server',
    root: async () => '/tmp/root',
    spawn: async () => undefined,
    ...overrides,
  };
}

describe('LSPManager.ensureInstalled', () => {
  beforeEach(() => {
    execMock.mockReset();
  });

  it('已安装的二进制直接返回 true，不执行任何安装命令', async () => {
    const { LSPManager } = await import('./index.js');
    const manager = new LSPManager({
      servers: [fakeServer({ binary: 'node' })],
      autoInstall: true,
    });

    await expect(manager.ensureInstalled('fake-ts')).resolves.toBe(true);
    expect(execMock).not.toHaveBeenCalled();
  });

  it('并发调用只触发一次安装（两个 npm 同时写全局目录会互相破坏）', async () => {
    const { LSPManager } = await import('./index.js');
    // 用对象持有回调：直接写 `let release` 会被 TS 的控制流分析收窄成 never。
    const holder: { release?: () => void } = {};
    execMock.mockImplementation(
      (
        _command: string,
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        // 挂住安装，模拟 npm 正在跑；此时第二次调用必须复用同一个 Promise。
        holder.release = () => callback(null, '', '');
      },
    );

    const manager = new LSPManager({ servers: [fakeServer()], autoInstall: true });
    const first = manager.ensureInstalled('fake-ts');
    const second = manager.ensureInstalled('fake-ts');

    expect(execMock).toHaveBeenCalledTimes(1);
    holder.release?.();
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(false);
  });

  it('安装命令未装上二进制时开启冷却，冷却期内不再重复执行安装', async () => {
    const { LSPManager } = await import('./index.js');
    execMock.mockImplementation(
      (
        _command: string,
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        // 退出码 0，但二进制并不存在（`a || b` 这类命令的典型形态）。
        callback(null, '', '');
      },
    );

    const manager = new LSPManager({ servers: [fakeServer()], autoInstall: true });

    await expect(manager.ensureInstalled('fake-ts')).resolves.toBe(false);
    expect(execMock).toHaveBeenCalledTimes(1);

    // 冷却期内：直接判定未安装，不再拉一次 npm（旧实现每次请求都要等满超时）。
    await expect(manager.ensureInstalled('fake-ts')).resolves.toBe(false);
    expect(execMock).toHaveBeenCalledTimes(1);
  });

  it('安装回调抛出（npm 失败 / 超时）时同样进入冷却', async () => {
    const { LSPManager } = await import('./index.js');
    execMock.mockImplementation(
      (
        _command: string,
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback(new Error('npm ETIMEDOUT'), '', '');
      },
    );

    const manager = new LSPManager({ servers: [fakeServer()], autoInstall: true });

    await expect(manager.ensureInstalled('fake-ts')).resolves.toBe(false);
    await expect(manager.ensureInstalled('fake-ts')).resolves.toBe(false);
    expect(execMock).toHaveBeenCalledTimes(1);
  });

  it('没有安装命令的 server 不触发安装', async () => {
    const { LSPManager } = await import('./index.js');
    const manager = new LSPManager({
      servers: [fakeServer({ installCommand: undefined })],
      autoInstall: true,
    });

    await expect(manager.ensureInstalled('fake-ts')).resolves.toBe(false);
    expect(execMock).not.toHaveBeenCalled();
  });
});
