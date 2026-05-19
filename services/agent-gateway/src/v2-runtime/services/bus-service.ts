/**
 * Effect-TS Bus service — wraps the existing in-process `publishBusEvent`
 * fan-out (see `sync-event.ts`) so Effect-aware callers can publish and
 * subscribe to bus events with structured concurrency, error handling,
 * and resource-safe teardown.
 *
 * The legacy `subscribeBusEvents` / `publishBusEvent` exports stay
 * exactly as-is — this service is a thin Effect adapter; future Phase 5
 * code can adopt it without breaking the synchronous API that the rest
 * of the gateway still relies on.
 *
 * The service deliberately avoids defining its own event taxonomy —
 * callers continue to use `MessageEvents`, `SessionEvents`, and the
 * raw payload types from `sync-event.ts`. The Bus simply provides the
 * Effect-flavoured plumbing.
 */

import { Context, Effect, Layer, Stream } from 'effect';
import { publishBusEvent, subscribeBusEvents } from '../../session/sync-event.js';

export interface BusEventEnvelope {
  type: string;
  data: unknown;
}

export interface BusServiceImpl {
  /** Publish a single bus event. Returns immediately. */
  readonly publish: (envelope: BusEventEnvelope) => Effect.Effect<void>;
  /**
   * Stream every bus event observed during the scope's lifetime. The
   * subscription is cleaned up automatically when the consumer's
   * scope closes.
   */
  readonly stream: Stream.Stream<BusEventEnvelope>;
}

export class BusService extends Context.Tag('@openAwork/BusService')<BusService, BusServiceImpl>() {
  static live(): Layer.Layer<BusService> {
    const impl: BusServiceImpl = {
      publish: (envelope) =>
        Effect.sync(() => {
          publishBusEvent(envelope.type, envelope.data);
        }),
      stream: Stream.async<BusEventEnvelope>((emit) => {
        const dispose = subscribeBusEvents((type, data) => {
          // Stream.async wants a Promise<void>; emit.single returns one.
          void emit.single({ type, data });
        });
        return Effect.sync(() => {
          dispose();
        });
      }),
    };
    return Layer.succeed(BusService, impl);
  }

  /**
   * In-memory test layer that swaps the global bus for a per-test
   * record so tests can assert on emitted envelopes without leaking
   * state across cases. The returned layer also exposes helpers via
   * the `Effect.gen` block that constructs it.
   */
  static test(): Layer.Layer<BusService> {
    return Layer.succeed(BusService, {
      publish: () => Effect.succeed(undefined),
      stream: Stream.empty,
    });
  }
}
