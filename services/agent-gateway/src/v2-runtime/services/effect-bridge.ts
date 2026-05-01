/**
 * EffectBridge — fastify handler ↔ Effect program adapter.
 *
 * Most of the gateway is still imperative async/await. As Phase 5
 * Effect services come online, individual handlers (or smaller helpers
 * inside them) will start being authored as `Effect.gen` programs. To
 * avoid each call site re-implementing the
 * `Effect.runPromise(program.pipe(Effect.provide(layer)))` boilerplate,
 * `EffectBridge` provides a tiny family of helpers:
 *
 *   - `EffectBridge.run(layer, program)` — fire-and-await; rejects on
 *     failure with the original cause.
 *   - `EffectBridge.runOption(layer, program)` — succeeds with `null`
 *     when the program fails, useful for routes that want to fall
 *     back to the v1 path on any v2 error.
 *
 * The bridge is opinionated about supplying `BusService.live()` by
 * default so the Effect tree can publish bus events without the caller
 * having to compose the layer manually each time.
 */

import { Cause, Effect, Exit, Layer, Runtime } from 'effect';
import { BusService } from './bus-service.js';
import type { StorageService } from './storage-service.js';
import { resolveStorageLayer } from '../boot.js';

const defaultRuntime = Runtime.defaultRuntime;

const liveBusLayer = BusService.live();

/**
 * Compose any caller-supplied layer with the `BusService.live` baseline
 * so every Effect program has access to the bus by default.
 */
function withBaseline<R>(layer: Layer.Layer<R>): Layer.Layer<R | BusService> {
  return Layer.merge(liveBusLayer, layer);
}

export const EffectBridge = {
  /**
   * Run an Effect program with the supplied service layer and the
   * baseline `BusService.live`. Resolves with the success value;
   * rejects with the underlying error.
   */
  async run<R, E, A>(
    layer: Layer.Layer<R>,
    program: Effect.Effect<A, E, R | BusService>,
  ): Promise<A> {
    const provided = program.pipe(Effect.provide(withBaseline(layer)));
    return Runtime.runPromise(defaultRuntime)(provided);
  },

  /**
   * Run an Effect program and return `null` if it fails. Useful for
   * v2-runtime experimental code paths that should silently fall
   * through to the legacy v1 path on error.
   */
  async runOption<R, E, A>(
    layer: Layer.Layer<R>,
    program: Effect.Effect<A, E, R | BusService>,
  ): Promise<A | null> {
    const provided = program.pipe(Effect.provide(withBaseline(layer)));
    const exit = await Runtime.runPromiseExit(defaultRuntime)(provided);
    if (Exit.isSuccess(exit)) return exit.value;
    return null;
  },

  /**
   * Convenience: run a program that depends only on `StorageService`
   * (plus the implicit `BusService` baseline). The storage layer is
   * resolved via `resolveStorageLayer()` so live boot wiring is used
   * when available and a permissive test layer is used otherwise.
   */
  async runWithStorage<E, A>(
    program: Effect.Effect<A, E, StorageService | BusService>,
  ): Promise<A> {
    const provided = program.pipe(Effect.provide(withBaseline(resolveStorageLayer())));
    return Runtime.runPromise(defaultRuntime)(provided);
  },

  /**
   * Soft-fail variant of `runWithStorage`. Returns `null` if the
   * program errors out, matching `runOption`'s contract. Use this in
   * routes that want to opt into v2 storage but transparently fall
   * back to legacy behaviour on any failure.
   */
  async runWithStorageOption<E, A>(
    program: Effect.Effect<A, E, StorageService | BusService>,
  ): Promise<A | null> {
    const provided = program.pipe(Effect.provide(withBaseline(resolveStorageLayer())));
    const exit = await Runtime.runPromiseExit(defaultRuntime)(provided);
    if (Exit.isSuccess(exit)) return exit.value;
    return null;
  },

  /**
   * Convert an Effect Exit failure into a logger-friendly string. Used
   * by callers that want to surface v2-runtime errors in audit logs
   * without leaking the full Effect Cause structure to clients.
   */
  formatFailure<E>(exit: Exit.Exit<unknown, E>): string {
    if (Exit.isSuccess(exit)) return '';
    return Cause.pretty(exit.cause);
  },
};

export type { Effect, Layer } from 'effect';
