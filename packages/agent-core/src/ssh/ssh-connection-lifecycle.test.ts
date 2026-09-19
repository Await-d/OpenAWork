import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { SSHConnectionManagerImpl, type SSHConnection } from './ssh-connection-manager.js';

const connection: SSHConnection = {
  id: 'lifecycle',
  name: 'test',
  host: '127.0.0.1',
  port: 22,
  username: 'test',
  authType: 'password',
  password: 'test',
  status: 'disconnected',
  createdAt: 0,
};
class Client extends EventEmitter {
  exec = vi.fn();
  sftp = vi.fn();
  end = vi.fn(() => {
    this.emit('close');
  });
  connect = vi.fn(() => this);
}

describe('SSH 并发与取消', () => {
  it('并发 connect 只建立一个连接，已连接时复用', async () => {
    const client = new Client();
    const factory = vi.fn(async () => client);
    const manager = new SSHConnectionManagerImpl({ clientFactory: factory });
    manager.addConnection(connection);
    const first = manager.connect(connection.id);
    const second = manager.connect(connection.id);
    await vi.waitFor(() => expect(client.connect).toHaveBeenCalled());
    client.emit('ready');
    await Promise.all([first, second]);
    await manager.connect(connection.id);
    expect(factory).toHaveBeenCalledTimes(1);
    await manager.disconnect(connection.id);
  });

  it('握手中断开后，迟发 ready 不会恢复连接', async () => {
    const client = new Client();
    const manager = new SSHConnectionManagerImpl({ clientFactory: async () => client });
    manager.addConnection(connection);
    const pending = manager.connect(connection.id);
    const rejection = expect(pending).rejects.toThrow(/cancel|closed|disconnect/i);
    await vi.waitFor(() => expect(client.connect).toHaveBeenCalled());
    await manager.disconnect(connection.id);
    client.emit('ready');
    await rejection;
    expect(manager.getStatus(connection.id)).toBe('disconnected');
    expect(client.end).toHaveBeenCalled();
  });

  it('更新目标前关闭旧连接，旧事件不覆盖新状态', async () => {
    const client = new Client();
    const manager = new SSHConnectionManagerImpl({ clientFactory: async () => client });
    manager.addConnection(connection);
    const pending = manager.connect(connection.id);
    await vi.waitFor(() => expect(client.connect).toHaveBeenCalled());
    client.emit('ready');
    await pending;
    manager.addConnection({ ...connection, host: 'new-host' });
    expect(client.end).toHaveBeenCalled();
    expect(manager.getStatus(connection.id)).toBe('disconnected');
    client.emit('error', new Error('old error'));
    expect(manager.getConnection(connection.id)?.host).toBe('new-host');
  });
});
