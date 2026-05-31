import { describe, expect, it, vi } from 'vitest';
import { dispatchStreamEvent, type GatewayStreamEvent } from './gateway-ws.js';

function doneEvent(): GatewayStreamEvent {
  return { type: 'done', stopReason: 'end_turn' } as GatewayStreamEvent;
}

describe('dispatchStreamEvent', () => {
  it('一个 handler 抛错不会阻断其余 handler', () => {
    const calls: string[] = [];
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const handlers = new Set<(e: GatewayStreamEvent) => void>([
      () => calls.push('first'),
      () => {
        throw new Error('stale subscriber');
      },
      () => calls.push('third'),
    ]);

    expect(() => dispatchStreamEvent(handlers, doneEvent())).not.toThrow();
    expect(calls).toEqual(['first', 'third']);
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });

  it('mid-dispatch 退订当前轮仍按快照分发，不丢事件、不报错', () => {
    const calls: string[] = [];
    const handlers = new Set<(e: GatewayStreamEvent) => void>();

    const self = (): void => {
      calls.push('self');
      handlers.delete(self);
    };
    handlers.add(self);
    handlers.add(() => calls.push('other'));

    dispatchStreamEvent(handlers, doneEvent());
    expect(calls).toEqual(['self', 'other']);
    expect(handlers.has(self)).toBe(false);
  });

  it('无 handler 时安全 no-op', () => {
    expect(() => dispatchStreamEvent(new Set(), doneEvent())).not.toThrow();
  });
});
