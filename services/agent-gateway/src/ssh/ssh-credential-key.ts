import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { resolveGatewayDataDir } from '../infra/storage-paths.js';

const keySchema = z.string().regex(/^[a-f0-9]{64}$/);
const ringSchema = z.object({ key: keySchema, legacyKey: keySchema });
type KeyRing = z.infer<typeof ringSchema>;
const cache = new Map<string, KeyRing>();

export class SshCredentialKeyError extends Error {
  override readonly name = 'SshCredentialKeyError';
}

export function sshCredentialKeys(): { key: Buffer; legacyKey: Buffer } {
  const path = join(resolveGatewayDataDir(), 'ssh-credential-key.json');
  let ring = cache.get(path);
  if (!ring) {
    try {
      ring = ringSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
      const secret = process.env['JWT_SECRET'] ?? 'change-me-in-production-min-32-chars';
      const generated: KeyRing = {
        key: randomBytes(32).toString('hex'),
        // 仅迁移历史 enc.v1 数据，新数据始终用独立随机密钥。
        legacyKey: createHash('sha256').update(`ssh-cred:${secret}`).digest('hex'),
      };
      mkdirSync(resolveGatewayDataDir(), { recursive: true, mode: 0o700 });
      try {
        writeFileSync(path, JSON.stringify(generated), { flag: 'wx', mode: 0o600 });
        ring = generated;
      } catch (writeError) {
        if (
          !(writeError instanceof Error) ||
          !('code' in writeError) ||
          writeError.code !== 'EEXIST'
        )
          throw writeError;
        ring = ringSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
      }
    }
    cache.set(path, ring);
  }
  if (!ring) throw new SshCredentialKeyError('SSH credential key is unavailable');
  return { key: Buffer.from(ring.key, 'hex'), legacyKey: Buffer.from(ring.legacyKey, 'hex') };
}
