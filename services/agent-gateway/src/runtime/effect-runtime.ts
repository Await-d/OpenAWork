import { Effect, Layer } from 'effect';
import * as ManagedRuntime from 'effect/ManagedRuntime';
import type { ConfigServiceOptions } from '../services/config-service.js';
import type { GatewayConfig } from '../types/effect-services.js';
import {
  ConfigService,
  DiagnosticsService,
  LoggerService,
  type LoggerServiceOptions,
} from '../services/index.js';

export interface EffectRuntimeOptions {
  readonly config?: ConfigServiceOptions | Partial<GatewayConfig>;
  readonly logger?: LoggerServiceOptions;
}

export type EffectRuntimeServices = LoggerService | ConfigService | DiagnosticsService;
export type EffectRuntime = ManagedRuntime.ManagedRuntime<EffectRuntimeServices, never>;

const isConfigServiceOptions = (
  value: ConfigServiceOptions | Partial<GatewayConfig>,
): value is ConfigServiceOptions => 'env' in value || 'overrides' in value;

const configLayer = (
  config: ConfigServiceOptions | Partial<GatewayConfig> | undefined,
): Layer.Layer<ConfigService> => {
  if (config === undefined) return ConfigService.live();
  return isConfigServiceOptions(config)
    ? ConfigService.live(config)
    : ConfigService.live({ overrides: config });
};

export const makeEffectRuntime = (options: EffectRuntimeOptions = {}): EffectRuntime => {
  const loggerAndConfig = Layer.merge(
    LoggerService.live(options.logger),
    configLayer(options.config),
  );
  const services = Layer.merge(loggerAndConfig, DiagnosticsService.live());
  return ManagedRuntime.make(services);
};

export const createEffectRuntime = makeEffectRuntime;

export const runEffect = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(effect);

export const runEffectExit = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromiseExit(effect);

export const runEffectSync = <A, E>(effect: Effect.Effect<A, E>): A => Effect.runSync(effect);

export const runWithRuntime = <A, E, R>(
  runtime: ManagedRuntime.ManagedRuntime<R, never>,
  effect: Effect.Effect<A, E, R>,
): Promise<A> => runtime.runPromise(effect);

export {
  ConfigService,
  DiagnosticsService,
  LoggerService,
  type ConfigServiceOptions,
  type LoggerServiceOptions,
} from '../services/index.js';
