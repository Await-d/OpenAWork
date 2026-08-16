/**
 * Effect-TS Service shell for the V2 storage layer.
 *
 * Mirrors opencode's `Session.Service` / `MessageV2.Service` pattern:
 * the service exposes pure-data accessors as `Effect.Effect<...>`s so
 * downstream callers can compose with retries, timeouts, telemetry,
 * etc. without wrapping each call site by hand.
 *
 * Phase 5 entry point: not wired into production yet. The service is
 * built lazily via `StorageService.live(handle)` so callers get a
 * reusable Layer they can supply at the gateway boot.
 */

import { Context, Effect, Layer } from 'effect';
import {
  V2Storage,
  type DrizzleHandle,
  type EventLogRow,
  type MessageV2Row,
  type PartV2Row,
  type SessionEntryRow,
  type SessionRow,
} from '../storage/index.js';

// ─── Service interface ──────────────────────────────────────────────

export interface StorageServiceImpl {
  readonly getSession: (sessionId: string) => Effect.Effect<SessionRow | undefined>;
  readonly getMessage: (input: {
    sessionId: string;
    messageId: string;
  }) => Effect.Effect<MessageV2Row | undefined>;
  readonly listMessages: (input: {
    sessionId: string;
    userId: string;
    afterTime?: number;
    limit?: number;
  }) => Effect.Effect<MessageV2Row[]>;
  readonly listPartsForMessage: (messageId: string) => Effect.Effect<PartV2Row[]>;
  readonly listSessionEntries: (input: {
    sessionId: string;
    clientRequestId?: string;
    afterSeq?: number;
  }) => Effect.Effect<SessionEntryRow[]>;
  readonly listEventLog: (aggregateId: string) => Effect.Effect<EventLogRow[]>;
  readonly allocateNextEventSeq: (aggregateId: string) => Effect.Effect<number>;
}

export class StorageService extends Context.Service<StorageService, StorageServiceImpl>()(
  '@openAwork/StorageService',
) {
  /**
   * Build a `Layer` that wires a concrete `V2Storage` (drizzle façade)
   * into the Effect context. Gateway boot calls this once with the
   * shared SQLite connection and supplies the resulting layer to any
   * `Effect.gen` block that needs storage access.
   */
  static live(handle: DrizzleHandle): Layer.Layer<StorageService> {
    const storage = V2Storage.fromHandle(handle);
    return Layer.succeed(
      StorageService,
      StorageService.of({
        getSession: (sessionId) => Effect.promise(() => storage.getSession(sessionId)),
        getMessage: (input) => Effect.promise(() => storage.getMessage(input)),
        listMessages: (input) => Effect.promise(() => storage.listMessages(input)),
        listPartsForMessage: (messageId) =>
          Effect.promise(() => storage.listPartsForMessage(messageId)),
        listSessionEntries: (input) => Effect.promise(() => storage.listSessionEntries(input)),
        listEventLog: (aggregateId) => Effect.promise(() => storage.listEventLog(aggregateId)),
        allocateNextEventSeq: (aggregateId) =>
          Effect.promise(() => storage.allocateNextEventSeq(aggregateId)),
      }),
    );
  }

  /**
   * In-memory test layer: callers pass a fully-formed implementation
   * (typically a partial mock) and any methods omitted default to a
   * "session not found" / empty array response. Useful for tests that
   * only exercise a subset of the service surface.
   */
  static test(impl: Partial<StorageServiceImpl>): Layer.Layer<StorageService> {
    const fallback: StorageServiceImpl = {
      getSession: () => Effect.succeed(undefined),
      getMessage: () => Effect.succeed(undefined),
      listMessages: () => Effect.succeed([]),
      listPartsForMessage: () => Effect.succeed([]),
      listSessionEntries: () => Effect.succeed([]),
      listEventLog: () => Effect.succeed([]),
      allocateNextEventSeq: () => Effect.succeed(1),
    };
    return Layer.succeed(StorageService, StorageService.of({ ...fallback, ...impl }));
  }
}
