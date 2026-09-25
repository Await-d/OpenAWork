/**
 * Plugin storage domain (`src/plugin/storage.ts`).
 *
 * Pins down the durable per-plugin KV contract:
 *   1. JSON round-trip (including nested objects) and missing keys.
 *   2. Isolation between plugin ids sharing the same key name.
 *   3. Prefix scan ordering + limit, with LIKE wildcards treated
 *      literally (a prefix containing `%` must not widen the match).
 *   4. Value guards: non-serializable values and oversized payloads
 *      are rejected before touching the database.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as StorageModule from '../../plugin/storage.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let db: typeof DbModule;
let storageModule: typeof StorageModule;

beforeAll(async () => {
  db = await import('../../infra/db.js');
  await db.connectDb();
  await db.migrate();
  storageModule = await import('../../plugin/storage.js');
}, 60000);

beforeEach(() => {
  db.sqliteRun('DELETE FROM plugin_storage', []);
});

describe('plugin storage domain', () => {
  it('round-trips JSON values and reports missing keys as undefined', async () => {
    const storage = storageModule.createPluginStorage('plugin-a');
    await storage.set('settings', { strict: true, count: 2, tags: ['x', 'y'] });
    expect(await storage.get('settings')).toEqual({ strict: true, count: 2, tags: ['x', 'y'] });
    expect(await storage.get('missing')).toBeUndefined();
  });

  it('isolates storage between plugins sharing a key name', async () => {
    const a = storageModule.createPluginStorage('plugin-a');
    const b = storageModule.createPluginStorage('plugin-b');
    await a.set('shared-key', 'from-a');
    await b.set('shared-key', 'from-b');

    expect(await a.get('shared-key')).toBe('from-a');
    expect(await b.get('shared-key')).toBe('from-b');
    expect((await a.scan()).entries).toHaveLength(1);
    expect((await b.scan()).entries).toHaveLength(1);
  });

  it('removes keys and overwrites existing values', async () => {
    const storage = storageModule.createPluginStorage('plugin-a');
    await storage.set('temp', 1);
    await storage.set('temp', 2);
    expect(await storage.get('temp')).toBe(2);

    await storage.remove('temp');
    expect(await storage.get('temp')).toBeUndefined();
    // Removing an absent key is a no-op.
    await storage.remove('temp');
  });

  it('scans by prefix in key order with a limit', async () => {
    const storage = storageModule.createPluginStorage('plugin-a');
    await storage.set('cache:b', 2);
    await storage.set('cache:a', 1);
    await storage.set('other', 3);

    const scoped = await storage.scan({ prefix: 'cache:' });
    expect(scoped.entries.map((entry) => entry.key)).toEqual(['cache:a', 'cache:b']);

    const limited = await storage.scan({ limit: 1 });
    expect(limited.entries).toHaveLength(1);
  });

  it('treats LIKE wildcards in the prefix literally', async () => {
    const storage = storageModule.createPluginStorage('plugin-a');
    await storage.set('a%b', 1);
    await storage.set('axxb', 2);

    const result = await storage.scan({ prefix: 'a%b' });
    expect(result.entries.map((entry) => entry.key)).toEqual(['a%b']);
  });

  it('rejects non-serializable and oversized values', async () => {
    const storage = storageModule.createPluginStorage('plugin-a');
    await expect(storage.set('fn', () => 1)).rejects.toThrow(/JSON-serializable/);
    await expect(storage.set('undef', undefined)).rejects.toThrow(/JSON-serializable/);

    const oversized = 'x'.repeat(256 * 1024 + 1);
    await expect(storage.set('huge', oversized)).rejects.toThrow(/exceeds/);
    expect(await storage.get('huge')).toBeUndefined();
  });
});
