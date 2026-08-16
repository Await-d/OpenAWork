import { Context, Effect, Layer } from 'effect';
import type {
  DiagnosticEvent,
  DiagnosticEventInput,
  DiagnosticsServiceShape,
  DiagnosticsSnapshot,
} from '../types/effect-services.js';

export class DiagnosticsService extends Context.Service<
  DiagnosticsService,
  DiagnosticsServiceShape
>()('@openAwork/EffectDiagnosticsService') {
  static live(): Layer.Layer<DiagnosticsService> {
    const counters = new Map<string, number>();
    const events: DiagnosticEvent[] = [];

    const snapshot = Effect.sync((): DiagnosticsSnapshot => ({
      counters: Object.fromEntries(counters.entries()),
      events: [...events],
    }));

    return Layer.succeed(DiagnosticsService, {
      record: (event: DiagnosticEventInput) =>
        Effect.sync(() => {
          counters.set(event.name, (counters.get(event.name) ?? 0) + (event.value ?? 1));
          events.push({ ...event, timestamp: Date.now() });
        }),
      snapshot,
      reset: Effect.sync(() => {
        counters.clear();
        events.length = 0;
      }),
    });
  }
}
