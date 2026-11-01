/**
 * 会话级凭据存储（261101，真实内存 SQLite）。
 *
 * 守方案 §4 的三条硬要求：
 *   1. **明文不落库**——库里只有信封加密后的密文；
 *   2. **归属逐次验证**——拿不到别的会话的凭据，也解析不出别的会话的明文；
 *   3. **引用必须存在**——引用一个不存在的名字不放行，而不是「解析失败就不带凭据连」。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as SecretStoreModule from '../../session-extension/session-extension-secret-store.js';
import type * as PolicyModule from '../../session-extension/session-extension-runtime-policy.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

const USER_ID = 'u-secret';
const SESSION_A = 's-secret-a';
const SESSION_B = 's-secret-b';

let db: typeof DbModule;
let secrets: typeof SecretStoreModule;
let policy: typeof PolicyModule;

beforeAll(async () => {
  db = await import('../../infra/db.js');
  await db.connectDb();
  await db.migrate();
  secrets = await import('../../session-extension/session-extension-secret-store.js');
  policy = await import('../../session-extension/session-extension-runtime-policy.js');
});

afterAll(async () => {
  await db.closeDb();
});

beforeEach(() => {
  db.sqliteRun('DELETE FROM session_extension_secrets', []);
  db.sqliteRun('DELETE FROM sessions', []);
  db.sqliteRun('DELETE FROM users', []);
  db.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
  for (const id of [SESSION_A, SESSION_B]) {
    db.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
       VALUES (?, ?, 'demo', '{}', 'idle')`,
      [id, USER_ID],
    );
  }
});

describe('凭据存储', () => {
  it('名称只接受保守字符集', () => {
    expect(secrets.isValidSessionExtensionSecretName('api-key')).toBe(true);
    expect(secrets.isValidSessionExtensionSecretName('A.b_c-1')).toBe(true);
    expect(secrets.isValidSessionExtensionSecretName('has:colon')).toBe(false);
    expect(secrets.isValidSessionExtensionSecretName('has space')).toBe(false);
    expect(secrets.isValidSessionExtensionSecretName('')).toBe(false);
    expect(secrets.isValidSessionExtensionSecretName('x'.repeat(65))).toBe(false);
  });

  it('明文不落库：库里只有密文，且能原样解回', () => {
    expect(
      secrets.setSessionExtensionSecret({
        sessionId: SESSION_A,
        name: 'api-key',
        value: 'plain-secret-value',
      }),
    ).toBe(true);

    const row = db.sqliteGet<{ value_cipher: string }>(
      'SELECT value_cipher FROM session_extension_secrets WHERE session_id = ? AND name = ?',
      [SESSION_A, 'api-key'],
    );
    expect(row?.value_cipher).toBeDefined();
    expect(row?.value_cipher).not.toContain('plain-secret-value');
    expect(row?.value_cipher?.startsWith('enc.')).toBe(true);

    expect(
      secrets.resolveSessionExtensionSecretValue({ sessionId: SESSION_A, name: 'api-key' }),
    ).toEqual({ name: 'api-key', value: 'plain-secret-value' });
  });

  it('轮换会推进 updatedAt（连接指纹据此失效）', () => {
    secrets.setSessionExtensionSecret({
      sessionId: SESSION_A,
      name: 'api-key',
      value: 'v1',
      now: 1_000,
    });
    expect(secrets.getSessionExtensionSecretUpdatedAt(SESSION_A, 'api-key')).toBe(1_000);

    secrets.setSessionExtensionSecret({
      sessionId: SESSION_A,
      name: 'api-key',
      value: 'v2',
      now: 2_000,
    });
    expect(secrets.getSessionExtensionSecretUpdatedAt(SESSION_A, 'api-key')).toBe(2_000);
    expect(
      secrets.resolveSessionExtensionSecretValue({ sessionId: SESSION_A, name: 'api-key' })?.value,
    ).toBe('v2');
    // 同会话同名字只应有一行。
    expect(secrets.countSessionExtensionSecrets(SESSION_A)).toBe(1);
  });

  it('元数据只含名字与时间，取不到明文', () => {
    secrets.setSessionExtensionSecret({ sessionId: SESSION_A, name: 'b-key', value: 'x' });
    secrets.setSessionExtensionSecret({ sessionId: SESSION_A, name: 'a-key', value: 'y' });
    const metas = secrets.listSessionExtensionSecretMetas(SESSION_A);
    expect(metas.map((meta) => meta.name)).toEqual(['a-key', 'b-key']);
    expect(JSON.stringify(metas)).not.toContain('x');
  });

  it('删库后引用与解析同时失效', () => {
    secrets.setSessionExtensionSecret({ sessionId: SESSION_A, name: 'api-key', value: 'v' });
    expect(secrets.deleteSessionExtensionSecret(SESSION_A, 'api-key')).toBe(true);
    expect(secrets.hasSessionExtensionSecret(SESSION_A, 'api-key')).toBe(false);
    expect(
      secrets.resolveSessionExtensionSecretValue({ sessionId: SESSION_A, name: 'api-key' }),
    ).toBeNull();
  });

  it('凭据随会话删除级联清理', () => {
    secrets.setSessionExtensionSecret({ sessionId: SESSION_B, name: 'api-key', value: 'v' });
    db.sqliteRun('DELETE FROM sessions WHERE id = ?', [SESSION_B]);
    expect(secrets.countSessionExtensionSecrets(SESSION_B)).toBe(0);
  });

  it('按会话隔离：另一个会话解析不到本会话的凭据', () => {
    secrets.setSessionExtensionSecret({ sessionId: SESSION_A, name: 'api-key', value: 'v' });
    expect(
      secrets.resolveSessionExtensionSecretValue({ sessionId: SESSION_B, name: 'api-key' }),
    ).toBeNull();
  });
});

describe('策略门（引用 + 注入点 + 真实存在）', () => {
  const ref = 'session:s-secret-a:api-key';
  const binding = { kind: 'header' as const, name: 'Authorization' };

  it('引用不存在时拒绝，录入后放行', () => {
    const input = {
      config: { transport: 'sse' as const },
      secretRef: ref,
      sessionId: SESSION_A,
      secretBinding: binding,
    };
    expect(policy.resolveSessionMcpRuntimePolicyDenial(input)).toContain('不存在');

    secrets.setSessionExtensionSecret({ sessionId: SESSION_A, name: 'api-key', value: 'v' });
    expect(policy.resolveSessionMcpRuntimePolicyDenial(input)).toBeNull();
  });

  it('跨会话引用即使目标会话存在凭据也拒绝', () => {
    secrets.setSessionExtensionSecret({ sessionId: SESSION_B, name: 'api-key', value: 'v' });
    expect(
      policy.resolveSessionMcpRuntimePolicyDenial({
        config: { transport: 'sse' },
        secretRef: 'session:s-secret-b:api-key',
        sessionId: SESSION_A,
        secretBinding: binding,
      }),
    ).toContain('本会话');
  });
});
