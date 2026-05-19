import { describe, expect, it, vi } from 'vitest';
import { Effect, Layer } from 'effect';

// `BusService.live` transitively imports the legacy `db.ts` through
// `sync-event.ts`. That chain reaches `node:sqlite` whose `node:` protocol
// vite/vitest cannot resolve at bundle time. We stub the legacy db helpers
// here — they are completely unused for the BusService test cases since
// only `publishBusEvent` / `subscribeBusEvents` (pure in-process maps)
// are exercised.
vi.mock('../../db.js', () => ({
  sqliteAll: vi.fn(() => []),
  sqliteGet: vi.fn(() => undefined),
  sqliteRun: vi.fn(),
  sqliteTransaction: <T>(fn: () => T) => fn(),
}));

import { BusService, StorageService } from '../../v2-runtime/services/index.js';
import type { MessageV2Row, SessionRow } from '../../v2-runtime/storage/index.js';

// ─── StorageService ────────────────────────────────────────────────

describe('StorageService.test layer', () => {
  it('invokes the supplied stub and falls back to defaults for unspecified methods', async () => {
    const fixture: SessionRow = {
      id: 's-1',
      userId: 'u-1',
      title: 'demo',
      parentId: null,
      workspaceId: null,
      timeCreated: null,
      timeUpdated: null,
      timeCompacting: null,
      timeArchived: null,
      summaryAdditions: null,
      summaryDeletions: null,
      summaryFiles: null,
      summaryDiffs: null,
      revert: null,
      permission: null,
      createdAt: null,
      updatedAt: null,
    };

    const layer = StorageService.test({
      getSession: (id) => Effect.succeed(id === 's-1' ? fixture : undefined),
    });

    const program = Effect.gen(function* () {
      const storage = yield* StorageService;
      const found = yield* storage.getSession('s-1');
      const missing = yield* storage.getSession('s-x');
      const messages = yield* storage.listMessages({ sessionId: 's-1', userId: 'u-1' });
      return { found, missing, messageCount: messages.length };
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
    expect(result.found?.id).toBe('s-1');
    expect(result.missing).toBeUndefined();
    expect(result.messageCount).toBe(0);
  });

  it('allocateNextEventSeq is wired through the Layer', async () => {
    const layer = StorageService.test({
      allocateNextEventSeq: () => Effect.succeed(42),
    });

    const program = Effect.gen(function* () {
      const storage = yield* StorageService;
      return yield* storage.allocateNextEventSeq('s-1');
    });

    const seq = await Effect.runPromise(program.pipe(Effect.provide(layer)));
    expect(seq).toBe(42);
  });

  it('listMessages stub receives the correct input', async () => {
    let captured: { sessionId: string; userId: string; afterTime?: number; limit?: number } | null =
      null;
    const fakeRow: MessageV2Row = {
      id: 'm-1',
      sessionId: 's-1',
      userId: 'u-1',
      timeCreated: 1,
      data: '{}',
      createdAt: null,
      updatedAt: null,
    };
    const layer = StorageService.test({
      listMessages: (input) => {
        captured = input;
        return Effect.succeed([fakeRow]);
      },
    });

    const program = Effect.gen(function* () {
      const storage = yield* StorageService;
      return yield* storage.listMessages({
        sessionId: 's-1',
        userId: 'u-1',
        afterTime: 5,
        limit: 10,
      });
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
    expect(result).toEqual([fakeRow]);
    expect(captured).toEqual({
      sessionId: 's-1',
      userId: 'u-1',
      afterTime: 5,
      limit: 10,
    });
  });
});

// ─── BusService ─────────────────────────────────────────────────────

describe('BusService.live layer', () => {
  it('publish is callable and resolves successfully', async () => {
    const program = Effect.gen(function* () {
      const bus = yield* BusService;
      yield* bus.publish({ type: 'test.event', data: { hello: 'world' } });
      return 'ok';
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(BusService.live())));
    expect(result).toBe('ok');
  });

  it('test layer publishes are no-ops', async () => {
    const program = Effect.gen(function* () {
      const bus = yield* BusService;
      yield* bus.publish({ type: 'noop', data: undefined });
      return 'done';
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(BusService.test())));
    expect(result).toBe('done');
  });
});

// ─── Layer composition ─────────────────────────────────────────────
//
// The Storage and Bus services compose into a single runtime layer the
// gateway boot can supply. We model the shape here so future call
// sites can rely on `Layer.merge`.

describe('Layer.merge composition', () => {
  it('merging Storage.test + Bus.test exposes both services to the same program', async () => {
    const sharedLayer = Layer.merge(StorageService.test({}), BusService.test());

    const program = Effect.gen(function* () {
      const storage = yield* StorageService;
      const bus = yield* BusService;
      yield* bus.publish({ type: 'compose.test', data: null });
      return yield* storage.allocateNextEventSeq('s-merge');
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(sharedLayer)));
    expect(result).toBe(1);
  });
});
