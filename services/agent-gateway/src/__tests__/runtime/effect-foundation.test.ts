import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import {
  ConfigService,
  DiagnosticsService,
  LoggerService,
  makeEffectRuntime,
} from '../../runtime/effect-runtime.js';

describe('Effect foundation runtime', () => {
  it('provides typed configuration and diagnostics to a generator program', async () => {
    const runtime = makeEffectRuntime({
      config: {
        gatewayHost: '127.0.0.1',
        gatewayPort: 3456,
      },
    });

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const config = yield* ConfigService;
        const diagnostics = yield* DiagnosticsService;
        yield* diagnostics.record({ name: 'foundation.test', value: 1 });
        return {
          host: yield* config.get('gatewayHost'),
          snapshot: yield* diagnostics.snapshot,
        };
      }),
    );

    expect(result.host).toBe('127.0.0.1');
    expect(result.snapshot.counters['foundation.test']).toBe(1);
    await runtime.dispose();
  });

  it('routes logger records through an injectable sink', async () => {
    const records: string[] = [];
    const runtime = makeEffectRuntime({
      logger: {
        sink: (record) => {
          records.push(`${record.level}:${record.message}`);
        },
      },
    });

    await runtime.runPromise(
      Effect.gen(function* () {
        const logger = yield* LoggerService;
        yield* logger.info('foundation.ready');
      }),
    );

    expect(records).toEqual(['info:foundation.ready']);
    await runtime.dispose();
  });
});
