import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamFrameController } from './stream-frame-controller.js';
import type { StreamFrameHandle } from './stream-frame-controller.js';

let frames: Map<number, FrameRequestCallback>;
beforeEach(() => {
  frames = new Map();
  let next = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.set(++next, callback);
    return next;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    frames.delete(id);
  });
});
afterEach(() => vi.restoreAllMocks());

function harness(handleRef = { current: null as StreamFrameHandle | null }) {
  const drain = vi.fn();
  const syncSnapshot = vi.fn();
  const publishThinking = vi.fn();
  const publishSegments = vi.fn();
  const isActive = vi.fn(() => true);
  const controller = createStreamFrameController({
    sessionId: 'session',
    handleRef,
    drain,
    syncSnapshot,
    publishThinking,
    publishSegments,
    isActive,
  });
  return { controller, handleRef, drain, syncSnapshot, publishThinking, publishSegments, isActive };
}

describe('stream frame controller', () => {
  it('coalesces each state publication to one frame', () => {
    const h = harness();
    for (let i = 0; i < 100; i += 1) {
      h.controller.scheduleThinkingFlush();
      h.controller.scheduleSegmentsFlush();
    }
    expect(frames.size).toBe(2);
    for (const callback of frames.values()) callback(0);
    expect(h.publishThinking).toHaveBeenCalledOnce();
    expect(h.publishSegments).toHaveBeenCalledOnce();
  });

  it('flushes snapshot refs after switching away without publishing state', () => {
    const h = harness();
    h.controller.scheduleThinkingFlush();
    h.controller.scheduleSegmentsFlush();
    h.isActive.mockReturnValue(false);
    h.handleRef.current?.flushToRefs();
    expect(h.drain).toHaveBeenCalledOnce();
    expect(h.syncSnapshot).toHaveBeenCalledOnce();
    expect(h.drain.mock.invocationCallOrder[0]).toBeLessThan(
      h.syncSnapshot.mock.invocationCallOrder[0]!,
    );
    expect(h.publishThinking).not.toHaveBeenCalled();
    expect(h.publishSegments).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it('disposes idempotently and ignores late queued callbacks', () => {
    const h = harness();
    h.controller.scheduleThinkingFlush();
    h.controller.scheduleSegmentsFlush();
    const late = [...frames.values()];
    h.controller.dispose();
    h.controller.dispose();
    for (const callback of late) callback(0);
    h.controller.scheduleThinkingFlush();
    expect(h.handleRef.current).toBeNull();
    expect(frames.size).toBe(0);
    expect(h.drain).not.toHaveBeenCalled();
    expect(h.publishThinking).not.toHaveBeenCalled();
  });

  it('a replaced handle cannot flush or clear the next request on the same session', () => {
    const h = harness();
    h.controller.scheduleThinkingFlush();
    const old = h.handleRef.current;
    const late = [...frames.values()];
    const next = harness(h.handleRef);
    const current = next.handleRef.current;
    old?.flushToRefs();
    old?.dispose();
    for (const callback of late) callback(0);
    expect(next.handleRef.current).toBe(current);
    expect(h.drain).not.toHaveBeenCalled();
    expect(h.syncSnapshot).not.toHaveBeenCalled();
    expect(h.publishThinking).not.toHaveBeenCalled();
    expect(h.controller.isCurrent()).toBe(false);
    expect(next.controller.isCurrent()).toBe(true);
  });
});
