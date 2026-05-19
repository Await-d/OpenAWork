import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';

// Stub the legacy db helpers so importing v2-runtime/services (which
// pulls in BusService → sync-event → db.ts) does not trip the
// node:sqlite resolution in vitest.
import { vi } from 'vitest';
vi.mock('../../db.js', () => ({
  sqliteAll: vi.fn(() => []),
  sqliteGet: vi.fn(() => undefined),
  sqliteRun: vi.fn(),
  sqliteTransaction: <T>(fn: () => T) => fn(),
}));

import {
  bootV2Runtime,
  getDrizzleHandle,
  getStorageLayer,
  getV2Storage,
  isV2Storage,
  refreshRuntimeFlagsForTesting,
  resetV2RuntimeForTesting,
  resolveStorageLayer,
  shutdownV2Runtime,
  withV2Storage,
} from '../../v2-runtime/index.js';
import { EffectBridge, StorageService } from '../../v2-runtime/services/index.js';

// Minimal structural connection that satisfies the boot's NodeSqliteDatabase
// type. The drizzle handle is built but never asked to execute SQL, so
// `prepare` only needs to be callable.
const fakeConnection = {
  prepare(_sql: string) {
    return { all: () => [], run: () => undefined };
  },
};

beforeEach(() => {
  resetV2RuntimeForTesting();
  delete process.env['OPENAWORK_RUNTIME'];
  delete process.env['OPENAWORK_RUNTIME_STORAGE'];
  // Defeat the module-scoped flag cache so each spec sees a clean env.
  refreshRuntimeFlagsForTesting();
});

afterEach(() => {
  resetV2RuntimeForTesting();
  delete process.env['OPENAWORK_RUNTIME'];
  delete process.env['OPENAWORK_RUNTIME_STORAGE'];
  refreshRuntimeFlagsForTesting();
});

describe('bootV2Runtime', () => {
  it('returns null when neither the global flag nor the storage flag enable v2', () => {
    expect(isV2Storage()).toBe(false);
    const result = bootV2Runtime({ connection: fakeConnection });
    expect(result).toBeNull();
    expect(getDrizzleHandle()).toBeNull();
    expect(getV2Storage()).toBeNull();
    expect(getStorageLayer()).toBeNull();
  });

  it('boots when `force: true` is passed even with the flag off', () => {
    const result = bootV2Runtime({ connection: fakeConnection, force: true });
    expect(result).not.toBeNull();
    expect(getDrizzleHandle()).toBeTruthy();
    expect(getV2Storage()).toBeTruthy();
    expect(getStorageLayer()).toBeTruthy();
  });

  it('boots when only the storage sub-flag is set to v2', () => {
    process.env['OPENAWORK_RUNTIME_STORAGE'] = 'v2';
    refreshRuntimeFlagsForTesting();
    expect(isV2Storage()).toBe(true);
    const result = bootV2Runtime({ connection: fakeConnection });
    expect(result).not.toBeNull();
    expect(getDrizzleHandle()).toBeTruthy();
  });

  it('boots when the global flag is v2 and storage sub-flag is unset', () => {
    process.env['OPENAWORK_RUNTIME'] = 'v2';
    refreshRuntimeFlagsForTesting();
    expect(isV2Storage()).toBe(true);
    const result = bootV2Runtime({ connection: fakeConnection });
    expect(result).not.toBeNull();
  });

  it('respects the storage sub-flag even when the global flag opts out', () => {
    process.env['OPENAWORK_RUNTIME'] = 'v1';
    process.env['OPENAWORK_RUNTIME_STORAGE'] = 'v2';
    refreshRuntimeFlagsForTesting();
    expect(isV2Storage()).toBe(true);
    const result = bootV2Runtime({ connection: fakeConnection });
    expect(result).not.toBeNull();
  });

  it('treats unrecognised flag values as v1 (no boot)', () => {
    process.env['OPENAWORK_RUNTIME_STORAGE'] = 'v3-experimental';
    refreshRuntimeFlagsForTesting();
    expect(isV2Storage()).toBe(false);
    const result = bootV2Runtime({ connection: fakeConnection });
    expect(result).toBeNull();
  });

  it('is idempotent — repeated boots reuse the same handle', () => {
    const a = bootV2Runtime({ connection: fakeConnection, force: true });
    const b = bootV2Runtime({ connection: fakeConnection, force: true });
    expect(a).toBe(b);
    expect(getDrizzleHandle()).toBe(a?.drizzle);
  });

  it('shutdownV2Runtime invalidates the cached handle so the next boot starts fresh', () => {
    const a = bootV2Runtime({ connection: fakeConnection, force: true });
    expect(a).not.toBeNull();
    shutdownV2Runtime();
    expect(getDrizzleHandle()).toBeNull();
    expect(getV2Storage()).toBeNull();
    expect(getStorageLayer()).toBeNull();
    const b = bootV2Runtime({ connection: fakeConnection, force: true });
    expect(b).not.toBeNull();
    expect(b).not.toBe(a);
  });

  it('withV2Storage returns null when boot has not run', () => {
    const result = withV2Storage((storage) => storage);
    expect(result).toBeNull();
  });

  it('withV2Storage exposes the V2Storage instance after boot', () => {
    bootV2Runtime({ connection: fakeConnection, force: true });
    const result = withV2Storage((storage) => storage);
    expect(result).not.toBeNull();
  });

  it('resolveStorageLayer falls back to the supplied test layer when boot has not run', async () => {
    const fallback = StorageService.test({
      allocateNextEventSeq: () => Effect.succeed(99),
    });
    const layer = resolveStorageLayer(fallback);
    const program = Effect.gen(function* () {
      const storage = yield* StorageService;
      return yield* storage.allocateNextEventSeq('s-x');
    });
    const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
    expect(result).toBe(99);
  });

  it('resolveStorageLayer prefers the booted live layer when available', async () => {
    bootV2Runtime({ connection: fakeConnection, force: true });
    // The live layer wires StorageService.live(handle) — calling
    // `getSession` against the empty fake connection should resolve
    // to undefined rather than the fallback's stub value.
    const fallback = StorageService.test({
      getSession: () => Effect.succeed({ id: 'fallback' } as never),
    });
    const layer = resolveStorageLayer(fallback);
    const program = Effect.gen(function* () {
      const storage = yield* StorageService;
      return yield* storage.getSession('s-x');
    });
    const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
    expect(result).toBeUndefined();
  });
});

describe('EffectBridge.runWithStorage', () => {
  it('uses the booted live layer when available', async () => {
    bootV2Runtime({ connection: fakeConnection, force: true });
    const program = Effect.gen(function* () {
      const storage = yield* StorageService;
      return yield* storage.listMessages({ sessionId: 's-1', userId: 'u-1' });
    });
    const result = await EffectBridge.runWithStorage(program);
    expect(result).toEqual([]);
  });

  it('falls back to a permissive test layer when boot has not run', async () => {
    const program = Effect.gen(function* () {
      const storage = yield* StorageService;
      return yield* storage.allocateNextEventSeq('s-x');
    });
    const result = await EffectBridge.runWithStorage(program);
    // Test fallback's allocateNextEventSeq returns 1 by default.
    expect(result).toBe(1);
  });

  it('runWithStorageOption returns null on failure', async () => {
    const program = Effect.gen(function* () {
      yield* Effect.fail(new Error('boom'));
      return 'unreachable';
    });
    const result = await EffectBridge.runWithStorageOption(program);
    expect(result).toBeNull();
  });
});
