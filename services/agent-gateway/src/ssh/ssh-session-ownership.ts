import { sqliteGet } from '../infra/db.js';

export class SshSessionOwnershipError extends Error {
  override readonly name = 'SshSessionOwnershipError';
}

export function requireOwnedSshSession(userId: string, sessionId: string): void {
  const session = sqliteGet<{ user_id: string }>('SELECT user_id FROM sessions WHERE id = ?', [
    sessionId,
  ]);
  if (session?.user_id !== userId) {
    throw new SshSessionOwnershipError('SSH session not found');
  }
}
