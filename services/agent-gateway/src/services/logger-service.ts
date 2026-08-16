import { Context, Effect, Layer } from 'effect';
import type {
  EffectLogLevel,
  EffectLogRecord,
  EffectLogRecordInput,
  LoggerServiceShape,
} from '../types/effect-services.js';

export interface LoggerServiceOptions {
  readonly sink?: (record: EffectLogRecord) => void;
}

const defaultSink = (record: EffectLogRecord): void => {
  const line = JSON.stringify(record);
  if (record.level === 'error') {
    console.error(line);
    return;
  }
  if (record.level === 'warn') {
    console.warn(line);
    return;
  }
  console.log(line);
};

const toEffectLog = (
  level: EffectLogLevel,
  message: string,
  fields?: Readonly<Record<string, unknown>>,
): EffectLogRecordInput => ({
  level,
  message,
  ...(fields === undefined ? {} : { fields }),
});

export class LoggerService extends Context.Service<LoggerService, LoggerServiceShape>()(
  '@openAwork/EffectLoggerService',
) {
  static live(options: LoggerServiceOptions = {}): Layer.Layer<LoggerService> {
    const sink = options.sink ?? defaultSink;
    const log = (input: EffectLogRecordInput): Effect.Effect<void> =>
      Effect.sync(() => {
        sink({ ...input, timestamp: Date.now() });
      });
    const byLevel =
      (level: EffectLogLevel) =>
      (message: string, fields?: Readonly<Record<string, unknown>>): Effect.Effect<void> =>
        log(toEffectLog(level, message, fields));

    return Layer.succeed(LoggerService, {
      log,
      debug: byLevel('debug'),
      info: byLevel('info'),
      warn: byLevel('warn'),
      error: byLevel('error'),
    });
  }
}
