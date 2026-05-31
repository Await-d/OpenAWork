import { describe, expect, it, vi } from 'vitest';
import { DAGRunner } from './dag.js';
import type { DAGEvent } from './types.js';

/**
 * Regression (§0.107, per-subscriber fault isolation): DAGRunner.emit fans a
 * DAG event out to every subscriber. Before the fix it iterated the handler
 * set with no per-handler guard, so one throwing subscriber (e.g. a closed
 * SSE/WS socket whose write rejects) aborted delivery to the remaining
 * subscribers AND bubbled back into the orchestration loop that called emit
 * (several emits — notably the terminal `dag_completed` — run inside
 * executeDAG). emit now isolates each handler + warns.
 */
describe('DAGRunner.emit per-subscriber resilience', () => {
  it('单个订阅者抛错时不中断其余订阅者，且 emit 不向调用方抛出', () => {
    const runner = new DAGRunner();
    const DAG_ID = 'dag-emit-test';
    const received: string[] = [];

    // First subscriber throws; the second must still receive the event.
    runner.subscribe(DAG_ID, () => {
      throw new Error('simulated subscriber failure');
    });
    runner.subscribe(DAG_ID, (event: DAGEvent) => {
      received.push(event.type);
    });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const event: DAGEvent = { type: 'dag_completed', result: {} as never, timestamp: Date.now() };
      // Must not throw despite the first subscriber throwing.
      expect(() => runner.emit(DAG_ID, event)).not.toThrow();
      // The healthy subscriber still received the event.
      expect(received).toEqual(['dag_completed']);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
