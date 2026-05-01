/**
 * Phase 5 services barrel — Effect-TS Service / Layer wrappers around
 * the V2 storage and SyncEvent bus.
 *
 * Phase 5 is intentionally additive: the legacy imperative APIs in
 * `message-store-v2.ts`, `session-entry-store.ts`, and `sync-event.ts`
 * stay in production. The Effect Service layer simply offers them in a
 * compositional shape that future opencode-style callers (Phase 5
 * follow-up) can consume without rewriting upstream interfaces.
 */

export { BusService, type BusEventEnvelope, type BusServiceImpl } from './bus-service.js';

export { StorageService, type StorageServiceImpl } from './storage-service.js';

export { EffectBridge } from './effect-bridge.js';
