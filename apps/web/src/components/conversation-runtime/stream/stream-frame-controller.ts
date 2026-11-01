import type { MutableRefObject } from 'react';

export interface StreamFrameHandle {
  readonly sessionId: string;
  flushToRefs: () => void;
  dispose: () => void;
}

interface StreamFrameControllerOptions {
  sessionId: string;
  handleRef: MutableRefObject<StreamFrameHandle | null>;
  isActive: () => boolean;
  drain: () => void;
  syncSnapshot: () => void;
  publishThinking: () => void;
  publishSegments: () => void;
}

/** A request owns its frames; snapshot flushing never publishes React state. */
export function createStreamFrameController(options: StreamFrameControllerOptions) {
  let thinkingFrame: number | null = null;
  let segmentsFrame: number | null = null;
  let disposed = false;
  const cancelThinkingFlush = () => {
    if (thinkingFrame !== null) window.cancelAnimationFrame(thinkingFrame);
    thinkingFrame = null;
  };
  const cancelSegmentsFlush = () => {
    if (segmentsFrame !== null) window.cancelAnimationFrame(segmentsFrame);
    segmentsFrame = null;
  };
  const isCurrent = () => !disposed && options.handleRef.current === handle;
  const handle: StreamFrameHandle = {
    sessionId: options.sessionId,
    flushToRefs() {
      if (!isCurrent()) return;
      cancelThinkingFlush();
      cancelSegmentsFlush();
      options.drain();
      options.syncSnapshot();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelThinkingFlush();
      cancelSegmentsFlush();
      if (options.handleRef.current === handle) options.handleRef.current = null;
    },
  };
  options.handleRef.current?.dispose();
  options.handleRef.current = handle;

  return {
    isCurrent,
    dispose: handle.dispose,
    cancelThinkingFlush,
    cancelSegmentsFlush,
    scheduleThinkingFlush() {
      if (!isCurrent() || thinkingFrame !== null) return;
      thinkingFrame = window.requestAnimationFrame(() => {
        thinkingFrame = null;
        if (!isCurrent() || !options.isActive()) return;
        options.drain();
        options.publishThinking();
      });
    },
    scheduleSegmentsFlush() {
      if (!isCurrent() || segmentsFrame !== null) return;
      segmentsFrame = window.requestAnimationFrame(() => {
        segmentsFrame = null;
        if (!isCurrent() || !options.isActive()) return;
        options.drain();
        options.publishSegments();
      });
    },
  };
}
