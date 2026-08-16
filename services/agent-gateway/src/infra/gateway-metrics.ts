import { Effect, Metric } from 'effect';

const DEFAULT_NAME_PREFIX = 'openawork_gateway';
const RESPONSE_DURATION_BOUNDARIES = [
  1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000,
] as const;

export interface GatewayMetricsOptions {
  readonly namePrefix?: string;
}

export interface GatewayMetricsSnapshot {
  readonly requestCount: Metric.CounterState<number>;
  readonly responseDuration: Metric.HistogramState;
  readonly responseStatuses: Readonly<Record<string, number>>;
}

export interface GatewayMetrics {
  readonly recordResponse: (statusCode: number, durationMs: number) => Effect.Effect<void>;
  readonly snapshot: Effect.Effect<GatewayMetricsSnapshot>;
  readonly prometheus: Effect.Effect<string>;
}

function normaliseNamePrefix(value: string | undefined): string {
  const normalised = (value ?? DEFAULT_NAME_PREFIX).trim().replace(/[^a-zA-Z0-9_]/g, '_');
  return normalised.length > 0 ? normalised : DEFAULT_NAME_PREFIX;
}

function normaliseDuration(durationMs: number): number {
  return Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;
}

function normaliseStatus(statusCode: number): string {
  return Number.isInteger(statusCode) && statusCode >= 100 ? String(statusCode) : 'unknown';
}

function renderPrometheus(prefix: string, snapshot: GatewayMetricsSnapshot): string {
  const statusMetricName = `${prefix}_response_status`;
  const durationMetricName = `${prefix}_response_duration_ms`;
  const lines = [
    `# HELP ${prefix}_requests_total Total HTTP requests handled by the gateway.`,
    `# TYPE ${prefix}_requests_total counter`,
    `${prefix}_requests_total ${snapshot.requestCount.count}`,
    `# HELP ${statusMetricName}_total HTTP responses grouped by status code.`,
    `# TYPE ${statusMetricName}_total counter`,
    ...Object.entries(snapshot.responseStatuses).map(
      ([status, count]) => `${statusMetricName}_total{status="${status}"} ${count}`,
    ),
    `# HELP ${durationMetricName} HTTP response duration in milliseconds.`,
    `# TYPE ${durationMetricName} histogram`,
    ...snapshot.responseDuration.buckets.map(
      ([boundary, count]) => `${durationMetricName}_bucket{le="${boundary}"} ${count}`,
    ),
    `${durationMetricName}_bucket{le="+Inf"} ${snapshot.responseDuration.count}`,
    `${durationMetricName}_count ${snapshot.responseDuration.count}`,
    `${durationMetricName}_sum ${snapshot.responseDuration.sum}`,
    '',
  ];
  return lines.join('\n');
}

export function makeGatewayMetrics(options: GatewayMetricsOptions = {}): GatewayMetrics {
  const prefix = normaliseNamePrefix(options.namePrefix);
  const requestCount = Metric.counter(`${prefix}_requests`, {
    description: 'Total HTTP requests handled by the gateway.',
    incremental: true,
  });
  const responseDuration = Metric.histogram(`${prefix}_response_duration_ms`, {
    description: 'HTTP response duration in milliseconds.',
    boundaries: RESPONSE_DURATION_BOUNDARIES,
  });
  const responseStatus = Metric.frequency(`${prefix}_response_status`);

  const recordResponse = (statusCode: number, durationMs: number): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* Metric.update(1)(requestCount);
      yield* Metric.update(normaliseDuration(durationMs))(responseDuration);
      yield* Metric.update(normaliseStatus(statusCode))(responseStatus);
    });

  const snapshot = Effect.gen(function* () {
    const requestState = yield* Metric.value(requestCount);
    const durationState = yield* Metric.value(responseDuration);
    const statusState = yield* Metric.value(responseStatus);
    return {
      requestCount: requestState,
      responseDuration: durationState,
      responseStatuses: Object.fromEntries(statusState.occurrences.entries()),
    } satisfies GatewayMetricsSnapshot;
  });

  return {
    recordResponse,
    snapshot,
    prometheus: snapshot.pipe(Effect.map((value) => renderPrometheus(prefix, value))),
  };
}
