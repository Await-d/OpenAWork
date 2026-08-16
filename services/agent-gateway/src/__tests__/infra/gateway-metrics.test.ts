import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { makeGatewayMetrics } from '../../infra/gateway-metrics.js';

describe('gateway metrics', () => {
  it('records responses and exposes a stable Prometheus snapshot', async () => {
    const metrics = makeGatewayMetrics({ namePrefix: 'openawork_test_gateway' });

    await Effect.runPromise(metrics.recordResponse(201, 12));
    await Effect.runPromise(metrics.recordResponse(500, 30));

    const snapshot = await Effect.runPromise(metrics.snapshot);

    expect(snapshot.requestCount.count).toBe(2);
    expect(snapshot.responseDuration.count).toBe(2);
    expect(snapshot.responseDuration.sum).toBe(42);
    expect(snapshot.responseStatuses).toEqual({ '201': 1, '500': 1 });

    const exposition = await Effect.runPromise(metrics.prometheus);
    expect(exposition).toContain('openawork_test_gateway_requests_total 2');
    expect(exposition).toContain('openawork_test_gateway_response_status_total{status="500"} 1');
    expect(exposition).toContain('openawork_test_gateway_response_duration_ms_sum 42');
  });
});
