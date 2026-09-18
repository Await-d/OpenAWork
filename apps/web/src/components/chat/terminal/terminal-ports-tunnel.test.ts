/**
 * 「复制隧道命令」的纯函数测试：三种绑定地址下 `-L` 目标的推导、默认 SSH 端口的
 * `-p` 省略、没有可用连接时的占位模板，以及连接挑选规则。
 *
 * 这里锁的是**命令字符串本身**：命令是复制给用户在别处执行的产物，写错一个地址
 * （比如 specific 监听写成 127.0.0.1）的表现是「隧道建立成功但连接被拒绝」，
 * 没有测试就只能在用户那里暴露。
 */

import { describe, expect, it } from 'vitest';
import type { SSHConnectionEntry } from '@openAwork/web-client';
import {
  buildSshTunnelCommand,
  describeBindAddress,
  pickSshConnection,
  tunnelTargetHost,
} from './terminal-ports-tunnel.js';

function makeSsh(overrides: Partial<SSHConnectionEntry> = {}): SSHConnectionEntry {
  return {
    id: 'ssh-1',
    host: 'gateway.example.com',
    port: 22,
    username: 'ubuntu',
    status: 'disconnected',
    ...overrides,
  };
}

describe('describeBindAddress：绑定地址归类', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.0.0.53', 'loopback'],
    ['::1', 'loopback'],
    ['localhost', 'loopback'],
    ['::ffff:127.0.0.1', 'loopback'],
    ['0.0.0.0', 'wildcard'],
    ['::', 'wildcard'],
    ['192.168.1.7', 'specific'],
    ['fd00::5', 'specific'],
  ])('%s → %s', (address, kind) => {
    expect(describeBindAddress(address).kind).toBe(kind);
  });
});

describe('tunnelTargetHost：-L 的远端目标地址', () => {
  it('回环与通配监听统一用 127.0.0.1（通配 socket 接受回环连接）', () => {
    expect(tunnelTargetHost('127.0.0.1')).toBe('127.0.0.1');
    expect(tunnelTargetHost('::1')).toBe('127.0.0.1');
    expect(tunnelTargetHost('0.0.0.0')).toBe('127.0.0.1');
    expect(tunnelTargetHost('::')).toBe('127.0.0.1');
  });

  it('specific 绑定用实际地址；IPv4-mapped 形式按 IPv4 语义归一', () => {
    expect(tunnelTargetHost('192.168.1.7')).toBe('192.168.1.7');
    expect(tunnelTargetHost('::ffff:192.168.1.7')).toBe('192.168.1.7');
  });

  it('specific IPv6 字面量加方括号（-L 的目标是 host[:port] 语法）', () => {
    expect(tunnelTargetHost('fd00::5')).toBe('[fd00::5]');
  });
});

describe('buildSshTunnelCommand：命令字符串', () => {
  it('回环监听：目标 127.0.0.1；SSH 默认 22 端口省略 -p', () => {
    const result = buildSshTunnelCommand({
      port: 3000,
      bindAddress: '127.0.0.1',
      ssh: makeSsh(),
    });

    expect(result).toEqual({
      form: 'ready',
      command: 'ssh -L 3000:127.0.0.1:3000 ubuntu@gateway.example.com',
      summary: 'ubuntu@gateway.example.com',
    });
  });

  it('通配监听：目标同样是 127.0.0.1（0.0.0.0 / :: 都接受回环连接）', () => {
    expect(
      buildSshTunnelCommand({ port: 5173, bindAddress: '0.0.0.0', ssh: makeSsh() }).command,
    ).toBe('ssh -L 5173:127.0.0.1:5173 ubuntu@gateway.example.com');
    expect(buildSshTunnelCommand({ port: 5173, bindAddress: '::', ssh: makeSsh() }).command).toBe(
      'ssh -L 5173:127.0.0.1:5173 ubuntu@gateway.example.com',
    );
  });

  it('specific 监听：目标是实际绑定地址（写 127.0.0.1 会被远端拒绝）', () => {
    expect(
      buildSshTunnelCommand({ port: 8080, bindAddress: '192.168.1.7', ssh: makeSsh() }).command,
    ).toBe('ssh -L 8080:192.168.1.7:8080 ubuntu@gateway.example.com');
  });

  it('SSH 非默认端口补上 -p；默认 22 不补', () => {
    const ssh = makeSsh({ host: 'dev.example.com', port: 2222, username: 'deploy' });
    expect(buildSshTunnelCommand({ port: 3000, bindAddress: '127.0.0.1', ssh }).command).toBe(
      'ssh -L 3000:127.0.0.1:3000 -p 2222 deploy@dev.example.com',
    );
  });

  it('没有可用 SSH 连接：输出占位模板，且保留按绑定地址算好的 -L 规格', () => {
    expect(buildSshTunnelCommand({ port: 3000, bindAddress: '127.0.0.1', ssh: null })).toEqual({
      form: 'placeholder',
      command: 'ssh -L 3000:127.0.0.1:3000 <用户名>@<主机>',
    });
    expect(
      buildSshTunnelCommand({ port: 8080, bindAddress: '192.168.1.7', ssh: null }).command,
    ).toBe('ssh -L 8080:192.168.1.7:8080 <用户名>@<主机>');
  });
});

describe('pickSshConnection：连接挑选', () => {
  it('优先取 connected 的条目（正在用的连接最可能就是网关那台机器）', () => {
    const idle = makeSsh({ id: 'a', host: 'a.example.com' });
    const connected = makeSsh({ id: 'b', host: 'b.example.com', status: 'connected' });

    expect(pickSshConnection([idle, connected])?.id).toBe('b');
  });

  it('没有 connected 条目时取第一条；空列表返回 null（调用方退化为模板）', () => {
    const first = makeSsh({ id: 'a' });

    expect(pickSshConnection([first, makeSsh({ id: 'b' })])?.id).toBe('a');
    expect(pickSshConnection([])).toBeNull();
  });
});
