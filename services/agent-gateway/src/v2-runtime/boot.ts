/**
 * v2-runtime boot — initialise the Phase 3 / Phase 5 service stack
 * once per gateway process and make the resulting `Layer`s available
 * to every caller.
 *
 * The boot is opt-in: it does nothing unless the gateway entry point
 * calls `bootV2Runtime({ connection })` and the `OPENAWORK_RUNTIME_STORAGE`
 * flag is set to `v2`. Without that, `getStorageLayer()` returns
 * `null` and Effect callers gracefully fall back to legacy paths.
 *
 * Boot is idempotent — calling `bootV2Runtime` multiple times reuses
 * the same `DrizzleHandle`, so hot-reload scenarios in tests don't
 * accumulate state.
 */

import type { Layer } from 'effect';
import { V2Storage, createDrizzleHandle, type DrizzleHandle } from './storage/index.js';
import { StorageService } from './services/storage-service.js';
import { isV2Storage } from './runtime-flag.js';

interface NodeSqliteDatabase {
  prepare(sql: string): unknown;
}

export interface BootV2RuntimeInput {
  /**
   * The shared `node:sqlite` `DatabaseSync` instance the legacy gateway
   * already maintains. The boot wraps it in a Drizzle handle without
   * mutating the connection itself.
   */
  connection: NodeSqliteDatabase;
  /**
   * Force the v2 storage stack regardless of the env flag. Useful for
   * tests that need the layer wired up deterministically.
   */
  force?: boolean;
}

interface BootedRuntime {
  drizzle: DrizzleHandle;
  storage: V2Storage;
  storageLayer: Layer.Layer<StorageService>;
}

let cached: BootedRuntime | null = null;

export function bootV2Runtime(input: BootV2RuntimeInput): BootedRuntime | null {
  if (!input.force && !isV2Storage()) {
    return null;
  }
  if (cached) return cached;
  const drizzle = createDrizzleHandle(input.connection);
  const storage = V2Storage.fromHandle(drizzle);
  const storageLayer = StorageService.live(drizzle);
  cached = { drizzle, storage, storageLayer };
  return cached;
}

export function getDrizzleHandle(): DrizzleHandle | null {
  return cached?.drizzle ?? null;
}

export function getV2Storage(): V2Storage | null {
  return cached?.storage ?? null;
}

export function getStorageLayer(): Layer.Layer<StorageService> | null {
  return cached?.storageLayer ?? null;
}

/**
 * Wipe the boot cache. Tests call this in `beforeEach` to ensure
 * each spec starts from a clean slate; production code should never
 * need it.
 */
export function resetV2RuntimeForTesting(): void {
  cached = null;
}

/**
 * Public shutdown hook for the gateway lifecycle. The drizzle handle
 * does not own the underlying `node:sqlite` connection (that lives in
 * legacy `db.ts` and is closed via `closeDb()`), so shutdown only has
 * to drop our cached references — once `closeDb()` runs, any cached
 * handle would point at a stale connection. Called from the Fastify
 * `onClose` hook to keep restart cycles clean.
 */
export function shutdownV2Runtime(): void {
  cached = null;
}

/**
 * Build a Layer that prefers the live storage service (when boot has
 * run) and falls back to a configurable test-friendly default. Used by
 * `EffectBridge.runWithStorage` so callers do not have to compose the
 * fallback themselves.
 */
export function resolveStorageLayer(
  fallback: Layer.Layer<StorageService> = StorageService.test({}),
): Layer.Layer<StorageService> {
  return cached?.storageLayer ?? fallback;
}

/**
 * Lower-level helper for callers that already have an
 * imperative-style code path: returns the V2Storage instance if v2
 * storage is wired up, otherwise null. Mirrors `getDrizzleHandle`'s
 * contract but at the storage façade level.
 */
export function withV2Storage<T>(fn: (storage: V2Storage) => T): T | null {
  if (!cached) return null;
  return fn(cached.storage);
}

/**
 * Internal helper for tests that need a minimal V2Storage-shaped
 * object without touching the real boot path.
 */
export const _internal = {
  setBooted(value: BootedRuntime | null): void {
    cached = value;
  },
} as const;

export type { BootedRuntime, NodeSqliteDatabase };
