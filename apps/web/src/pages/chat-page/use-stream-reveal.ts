import { useCallback, useEffect, useRef } from 'react';
import { calculateStreamingRevealStep, calculateStreamingRevealDelay } from './streaming-reveal.js';

export interface StreamRevealSetters {
  setStreamBuffer: (value: string) => void;
  setStreamThinkingBuffer: (value: string) => void;
  setRecoveredStreamSnapshot: (value: null) => void;
  setStreaming: (value: boolean) => void;
  setStoppingStream: (value: boolean) => void;
  setActiveStreamStartedAt: (value: number | null) => void;
  setActiveStreamFirstTokenLatencyMs: (value: number | null) => void;
}

export interface StreamRevealReturn {
  streamRevealTargetRef: React.MutableRefObject<string>;
  streamRevealVisibleRef: React.MutableRefObject<string>;
  streamRevealTargetCodePointsRef: React.MutableRefObject<string[]>;
  streamRevealVisibleCodePointCountRef: React.MutableRefObject<number>;
  streamRevealNextAllowedAtRef: React.MutableRefObject<number>;
  pendingStreamRevealFrameRef: React.MutableRefObject<number | null>;
  streamingRef: React.MutableRefObject<boolean>;
  stoppingStreamRef: React.MutableRefObject<boolean>;
  currentAssistantStreamMessageIdRef: React.MutableRefObject<string | null>;
  resetStreamState: () => void;
  scheduleStreamReveal: () => void;
}

export function useStreamReveal(
  prefersReducedMotion: boolean,
  setters: StreamRevealSetters,
): StreamRevealReturn {
  const {
    setStreamBuffer,
    setStreamThinkingBuffer,
    setRecoveredStreamSnapshot,
    setStreaming,
    setStoppingStream,
    setActiveStreamStartedAt,
    setActiveStreamFirstTokenLatencyMs,
  } = setters;
  const pendingStreamRevealFrameRef = useRef<number | null>(null);
  const streamingRef = useRef(false);
  const stoppingStreamRef = useRef(false);
  const currentAssistantStreamMessageIdRef = useRef<string | null>(null);
  const streamRevealTargetRef = useRef('');
  const streamRevealVisibleRef = useRef('');
  const streamRevealTargetCodePointsRef = useRef<string[]>([]);
  const streamRevealVisibleCodePointCountRef = useRef(0);
  const streamRevealNextAllowedAtRef = useRef(0);

  const resetStreamState = useCallback(() => {
    if (pendingStreamRevealFrameRef.current !== null) {
      cancelAnimationFrame(pendingStreamRevealFrameRef.current);
      pendingStreamRevealFrameRef.current = null;
    }
    stoppingStreamRef.current = false;
    streamRevealTargetRef.current = '';
    streamRevealVisibleRef.current = '';
    streamRevealTargetCodePointsRef.current = [];
    streamRevealVisibleCodePointCountRef.current = 0;
    streamRevealNextAllowedAtRef.current = 0;
    setStreamBuffer('');
    setStreamThinkingBuffer('');
    setRecoveredStreamSnapshot(null);
    streamingRef.current = false;
    setStreaming(false);
    setStoppingStream(false);
    setActiveStreamStartedAt(null);
    setActiveStreamFirstTokenLatencyMs(null);
    currentAssistantStreamMessageIdRef.current = null;
  }, [
    setStreamBuffer,
    setStreamThinkingBuffer,
    setRecoveredStreamSnapshot,
    setStreaming,
    setStoppingStream,
    setActiveStreamStartedAt,
    setActiveStreamFirstTokenLatencyMs,
  ]);

  const scheduleStreamReveal = useCallback(() => {
    if (pendingStreamRevealFrameRef.current !== null) {
      return;
    }

    const advance = (timestamp: number) => {
      pendingStreamRevealFrameRef.current = null;
      const shouldApplyCadence = timestamp > 0;

      if (prefersReducedMotion) {
        const immediateVisible = streamRevealTargetRef.current;
        streamRevealVisibleCodePointCountRef.current =
          streamRevealTargetCodePointsRef.current.length;
        streamRevealVisibleRef.current = immediateVisible;
        setters.setStreamBuffer(immediateVisible);
        return;
      }

      if (shouldApplyCadence && timestamp < streamRevealNextAllowedAtRef.current) {
        pendingStreamRevealFrameRef.current = requestAnimationFrame(advance);
        return;
      }

      const currentVisibleCount = streamRevealVisibleCodePointCountRef.current;
      const targetCodePoints = streamRevealTargetCodePointsRef.current;
      const pendingCharacters = targetCodePoints.length - currentVisibleCount;

      if (pendingCharacters <= 0) {
        return;
      }

      const nextVisibleCount = Math.min(
        targetCodePoints.length,
        currentVisibleCount + calculateStreamingRevealStep(pendingCharacters),
      );
      const appendedChunk = targetCodePoints.slice(currentVisibleCount, nextVisibleCount).join('');
      const nextVisible = streamRevealVisibleRef.current + appendedChunk;
      const lastRevealedCharacter = targetCodePoints[nextVisibleCount - 1];

      if (nextVisible !== streamRevealVisibleRef.current) {
        streamRevealVisibleCodePointCountRef.current = nextVisibleCount;
        streamRevealVisibleRef.current = nextVisible;
        setters.setStreamBuffer(nextVisible);
      }

      streamRevealNextAllowedAtRef.current = shouldApplyCadence
        ? timestamp +
          calculateStreamingRevealDelay(
            lastRevealedCharacter,
            targetCodePoints.length - nextVisibleCount,
          )
        : 0;

      if (nextVisibleCount < targetCodePoints.length) {
        pendingStreamRevealFrameRef.current = requestAnimationFrame(advance);
      }
    };

    pendingStreamRevealFrameRef.current = requestAnimationFrame(advance);
  }, [prefersReducedMotion, setStreamBuffer]);

  useEffect(() => {
    return () => {
      if (pendingStreamRevealFrameRef.current !== null) {
        cancelAnimationFrame(pendingStreamRevealFrameRef.current);
      }
    };
  }, []);

  return {
    streamRevealTargetRef,
    streamRevealVisibleRef,
    streamRevealTargetCodePointsRef,
    streamRevealVisibleCodePointCountRef,
    streamRevealNextAllowedAtRef,
    pendingStreamRevealFrameRef,
    streamingRef,
    stoppingStreamRef,
    currentAssistantStreamMessageIdRef,
    resetStreamState,
    scheduleStreamReveal,
  };
}
