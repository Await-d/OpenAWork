import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { decryptSecret, encryptSecret } from '../../ssh/ssh-secret-cipher.js';
const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it('旧 enc.v1 凭证在迁移并轮换 JWT 后仍可读取', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ssh-key-migration-'));
  dirs.push(dir);
  vi.stubEnv('OPENAWORK_DATA_DIR', dir);
  vi.stubEnv('JWT_SECRET', 'legacy-secret');
  const iv = randomBytes(12);
  const key = createHash('sha256').update('ssh-cred:legacy-secret').digest();
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update('legacy-password', 'utf8'), cipher.final()]);
  const payload =
    'enc.v1.' + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
  expect(decryptSecret(payload)).toBe('legacy-password');
  vi.stubEnv('JWT_SECRET', 'new-secret');
  expect(decryptSecret(payload)).toBe('legacy-password');
  expect(decryptSecret(encryptSecret('new-password'))).toBe('new-password');
});

it('损坏密文明确报错，不假装成未设置密码', () => {
  expect(() => decryptSecret('enc.v2.invalid')).toThrow(/损坏|解密失败/);
});
