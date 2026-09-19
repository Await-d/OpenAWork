import type { SSHConnection } from '@openAwork/agent-core';
import { sqliteGet, sqliteRun } from '../infra/db.js';

export class SshHostKeyError extends Error {
  override readonly name = 'SshHostKeyError';
}

export async function verifySshHostKey(
  connection: SSHConnection,
  fingerprint: string,
): Promise<boolean> {
  const owner = sqliteGet<{ user_id: string }>('SELECT user_id FROM ssh_connections WHERE id = ?', [
    connection.id,
  ]);
  if (!owner) throw new SshHostKeyError('SSH connection no longer exists');
  sqliteRun(`CREATE TABLE IF NOT EXISTS ssh_known_hosts (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    host TEXT NOT NULL, port INTEGER NOT NULL, fingerprint TEXT NOT NULL,
    PRIMARY KEY (user_id, host, port)
  )`);
  const host = connection.host.trim().toLowerCase();
  sqliteRun(
    'INSERT OR IGNORE INTO ssh_known_hosts (user_id, host, port, fingerprint) VALUES (?, ?, ?, ?)',
    [owner.user_id, host, connection.port, fingerprint],
  );
  const known = sqliteGet<{ fingerprint: string }>(
    'SELECT fingerprint FROM ssh_known_hosts WHERE user_id = ? AND host = ? AND port = ?',
    [owner.user_id, host, connection.port],
  );
  if (known?.fingerprint !== fingerprint) {
    throw new SshHostKeyError(
      `SSH host key mismatch: ${host}:${connection.port}; expected ${known?.fingerprint}; received ${fingerprint}。请通过可信渠道核实服务器主机密钥。`,
    );
  }
  return true;
}

export function replaceSshHostKey(input: {
  userId: string;
  connectionId: string;
  expectedFingerprint: string;
  fingerprint: string;
}): void {
  const connection = sqliteGet<{ host: string; port: number }>(
    'SELECT host, port FROM ssh_connections WHERE id = ? AND user_id = ?',
    [input.connectionId, input.userId],
  );
  if (!connection) throw new SshHostKeyError('SSH connection not found: ' + input.connectionId);
  const host = connection.host.trim().toLowerCase();
  const known = sqliteGet<{ fingerprint: string }>(
    'SELECT fingerprint FROM ssh_known_hosts WHERE user_id = ? AND host = ? AND port = ?',
    [input.userId, host, connection.port],
  );
  if (known?.fingerprint !== input.expectedFingerprint) {
    throw new SshHostKeyError('SSH host key changed again; refresh the expected fingerprint');
  }
  sqliteRun(
    'UPDATE ssh_known_hosts SET fingerprint = ? WHERE user_id = ? AND host = ? AND port = ? AND fingerprint = ?',
    [input.fingerprint, input.userId, host, connection.port, input.expectedFingerprint],
  );
}
