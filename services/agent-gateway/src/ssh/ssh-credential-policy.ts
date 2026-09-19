import { sqliteGet } from '../infra/db.js';
import type { PersistedSshConnection } from './ssh-store.js';

export class SshCredentialPolicyError extends Error {
  override readonly name = 'SshCredentialPolicyError';
}

/** 网关操作系统凭证仅授予部署管理员；普通用户使用自己的密码或粘贴私钥。 */
export function requireSshCredentialAccess(connection: PersistedSshConnection): void {
  const usesHostCredentials =
    connection.authType === 'agent' ||
    ((connection.authType === 'key' || connection.authType === 'key-password') &&
      !connection.privateKey &&
      Boolean(connection.privateKeyPath));
  if (!usesHostCredentials) return;
  const user = sqliteGet<{ email: string }>('SELECT email FROM users WHERE id = ?', [
    connection.userId,
  ]);
  const admin = process.env['ADMIN_EMAIL'] ?? 'admin@openAwork.local';
  if (user?.email !== admin) {
    throw new SshCredentialPolicyError(
      '网关私钥文件与 ssh-agent 仅供部署管理员使用，请使用自己的粘贴私钥或密码。',
    );
  }
}
