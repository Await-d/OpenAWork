import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { SSHConnectionManagerImpl } from './ssh-connection-manager.js';

class Client extends EventEmitter {
  exec = () => undefined;
  sftp = () => undefined;
  end = () => this.emit('close');
  connect() {
    queueMicrotask(() => this.emit('ready'));
    return this;
  }
}

describe('SSH 已建立连接的生命周期', () => {
  it.each(['close', 'end', 'error'])('%s 后不再保持 connected', async (event) => {
    const client = new Client();
    const manager = new SSHConnectionManagerImpl({ clientFactory: async () => client });
    manager.addConnection({
      id: 'test',
      name: 'test',
      host: 'localhost',
      port: 22,
      username: 'test',
      authType: 'password',
      password: 'test',
      status: 'disconnected',
      createdAt: 0,
    });
    await manager.connect('test');
    client.emit(event, new Error('connection lost'));
    expect(manager.getStatus('test')).not.toBe('connected');
    await expect(manager.execCommand('test', 'pwd')).rejects.toThrow(/not connected/);
  });
});
