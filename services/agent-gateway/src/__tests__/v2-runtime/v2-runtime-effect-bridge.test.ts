import { describe, expect, it, vi } from 'vitest';
import { Effect, Layer } from 'effect';

// Same rationale as v2-runtime-services.test.ts — stub the legacy
// db helpers so BusService.live's transitive sync-event import does
// not pull `node:sqlite` through the bundler.
vi.mock('../../infra/db.js', () => ({
  sqliteAll: vi.fn(() => []),
  sqliteGet: vi.fn(() => undefined),
  sqliteRun: vi.fn(),
  sqliteTransaction: <T>(fn: () => T) => fn(),
}));

import { EffectBridge, StorageService } from '../../v2-runtime/services/index.js';

describe('EffectBridge.run', () => {
  it('resolves with the program success value when the provided layer satisfies dependencies', async () => {
    const program = Effect.gen(function* () {
      const storage = yield* StorageService;
      return yield* storage.allocateNextEventSeq('s-1');
    });

    const result = await EffectBridge.run(
      StorageService.test({
        allocateNextEventSeq: () => Effect.succeed(7),
      }),
      program,
    );
    expect(result).toBe(7);
  });

  it('rejects when the program fails', async () => {
    const program = Effect.gen(function* () {
      const storage = yield* StorageService;
      yield* storage.getSession('boom');
      return yield* Effect.fail(new Error('explicit failure'));
    });

    await expect(EffectBridge.run(StorageService.test({}), program)).rejects.toThrow(
      /explicit failure/,
    );
  });

  it('lets multiple services be supplied via Layer.merge', async () => {
    type CounterImpl = { readonly bump: () => Effect.Effect<number> };
    class Counter extends Effect.Tag('test/Counter')<Counter, CounterImpl>() {}

    const counterLayer = Layer.succeed(Counter, {
      bump: () => Effect.succeed(123),
    });

    const program = Effect.gen(function* () {
      const counter = yield* Counter;
      return yield* counter.bump();
    });

    const result = await EffectBridge.run(counterLayer, program);
    expect(result).toBe(123);
  });
});

describe('EffectBridge.runOption', () => {
  it('returns the success value on success', async () => {
    const program = Effect.gen(function* () {
      const storage = yield* StorageService;
      return yield* storage.allocateNextEventSeq('s-1');
    });

    const result = await EffectBridge.runOption(
      StorageService.test({
        allocateNextEventSeq: () => Effect.succeed(2),
      }),
      program,
    );
    expect(result).toBe(2);
  });

  it('returns null on failure instead of rejecting', async () => {
    const program = Effect.gen(function* () {
      yield* Effect.fail(new Error('soft failure'));
      return 'unreachable';
    });

    const result = await EffectBridge.runOption(StorageService.test({}), program);
    expect(result).toBeNull();
  });

  it('returns null when the program throws synchronously inside Effect.sync', async () => {
    const program = Effect.sync<string>(() => {
      throw new Error('sync boom');
    });

    const result = await EffectBridge.runOption(StorageService.test({}), program);
    expect(result).toBeNull();
  });
});
