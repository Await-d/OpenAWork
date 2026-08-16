import type { Effect as EffectType } from 'effect/Effect';

export const EFFECT_LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export type EffectLogLevel = (typeof EFFECT_LOG_LEVELS)[number];

export interface EffectLogRecord {
  readonly level: EffectLogLevel;
  readonly message: string;
  readonly fields?: Readonly<Record<string, unknown>>;
  readonly timestamp: number;
}

export interface EffectLogRecordInput {
  readonly level: EffectLogLevel;
  readonly message: string;
  readonly fields?: Readonly<Record<string, unknown>>;
}

export interface GatewayConfig {
  readonly gatewayHost: string;
  readonly gatewayPort: number;
  readonly dataDir?: string;
  readonly databasePath?: string;
  readonly aiApiKey?: string;
  readonly aiApiBaseUrl: string;
  readonly aiDefaultModel: string;
}

export interface DiagnosticEventInput {
  readonly name: string;
  readonly value?: number;
  readonly fields?: Readonly<Record<string, unknown>>;
}

export interface DiagnosticEvent extends DiagnosticEventInput {
  readonly timestamp: number;
}

export interface DiagnosticsSnapshot {
  readonly counters: Readonly<Record<string, number>>;
  readonly events: readonly DiagnosticEvent[];
}

export interface LoggerServiceShape {
  readonly log: (record: EffectLogRecordInput) => EffectType<void>;
  readonly debug: (message: string, fields?: Readonly<Record<string, unknown>>) => EffectType<void>;
  readonly info: (message: string, fields?: Readonly<Record<string, unknown>>) => EffectType<void>;
  readonly warn: (message: string, fields?: Readonly<Record<string, unknown>>) => EffectType<void>;
  readonly error: (message: string, fields?: Readonly<Record<string, unknown>>) => EffectType<void>;
}

export interface ConfigServiceShape {
  readonly all: EffectType<GatewayConfig>;
  readonly get: <K extends keyof GatewayConfig>(key: K) => EffectType<GatewayConfig[K]>;
}

export interface DiagnosticsServiceShape {
  readonly record: (event: DiagnosticEventInput) => EffectType<void>;
  readonly snapshot: EffectType<DiagnosticsSnapshot>;
  readonly reset: EffectType<void>;
}
