import { useCallback, useRef, useState } from 'react';
import type { ChatBackendUsageSnapshot } from './stream-usage.js';
import type { RecoveredActiveAssistantStream } from './stream-recovery.js';
import { calculateStreamingRevealDelay, calculateStreamingRevealStep } from './streaming-reveal.js';

export interface UseChatStreamingReturn {
  streaming: boolean;
  setStreaming: React.Dispatch<React.SetStateAction<boolean>>;
  stoppingStream: boolean;
  setStoppingStream: React.Dispatch<React.SetStateAction<boolean>>;
  streamBuffer: string;
  setStreamBuffer: React.Dispatch<React.SetStateAction<string>>;
  streamThinkingBuffer: string;
  setStreamThinkingBuffer: React.Dispatch<React.SetStateAction<string>>;
  reportedStreamUsage: ChatBackendUsageSnapshot | null;
  setReportedStreamUsage: React.Dispatch<React.SetStateAction<ChatBackendUsageSnapshot | null>>;
  recoveredStreamSnapshot: RecoveredActiveAssistantStream | null;
  setRecoveredStreamSnapshot: React.Dispatch<
    React.SetStateAction<RecoveredActiveAssistantStream | null>
  >;
  activeStreamStartedAt: number | null;
  setActiveStreamStartedAt: React.Dispatch<React.SetStateAction<number | null>>;
  activeStreamFirstTokenLatencyMs: number | null;
  setActiveStreamFirstTokenLatencyMs: React.Dispatch<React.SetStateAction<number | null>>;
  streamError: string | null;
  setStreamError: React.Dispatch<React.SetStateAction<string | null>>;

  streamingRef: React.MutableRefObject<boolean>;
  stoppingStreamRef: React.MutableRefObject<boolean>;
  currentAssistantStreamMessageIdRef: React.MutableRefObject<string | null>;
  pendingStreamRevealFrameRef: React.MutableRefObject<number | null>;
  streamRevealTargetRef: React.MutableRefObject<string>;
  streamRevealVisibleRef: React.MutableRefObject<string>;
  streamRevealTargetCodePointsRef: React.MutableRefObject<string[]>;
  streamRevealVisibleCodePointCountRef: React.MutableRefObject<number>;
  streamRevealNextAllowedAtRef: React.MutableRefObject<number>;

  resetStreamState: () => void;
  scheduleStreamReveal: (opts: { prefersReducedMotion: boolean }) => void;
  isImmediatelyRenderableStructuredContent: (content: string) => boolean;
}

function checkIsImmediatelyRenderableStructuredContent(content: string): boolean {
  const normalized = content.trim();
  if (!normalized.startsWith('{') || !normalized.includes('"type"')) {
    return false;
  }

  try {
    JSON.parse(normalized);
    return true;
  } catch {
    return false;
  }
}

export function useChatStreaming(): UseChatStreamingReturn {
  const [streaming, setStreaming] = useState(false);
  const [stoppingStream, setStoppingStream] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState('');
  const [streamThinkingBuffer, setStreamThinkingBuffer] = useState('');
  const [reportedStreamUsage, setReportedStreamUsage] = useState<ChatBackendUsageSnapshot | null>(
    null,
  );
  const [recoveredStreamSnapshot, setRecoveredStreamSnapshot] =
    useState<RecoveredActiveAssistantStream | null>(null);
  const [activeStreamStartedAt, setActiveStreamStartedAt] = useState<number | null>(null);
  const [activeStreamFirstTokenLatencyMs, setActiveStreamFirstTokenLatencyMs] = useState<
    number | null
  >(null);
  const [streamError, setStreamError] = useState<string | null>(null);

  const streamingRef = useRef(false);
  const stoppingStreamRef = useRef(false);
  const currentAssistantStreamMessageIdRef = useRef<string | null>(null);
  const pendingStreamRevealFrameRef = useRef<number | null>(null);
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
  }, []);

  const scheduleStreamReveal = useCallback((opts: { prefersReducedMotion: boolean }) => {
    if (pendingStreamRevealFrameRef.current !== null) {
      return;
    }
    const advance = (timestamp: number) => {
      pendingStreamRevealFrameRef.current = null;
      const shouldApplyCadence = timestamp > 0;
      if (opts.prefersReducedMotion) {
        const immediateVisible = streamRevealTargetRef.current;
        streamRevealVisibleCodePointCountRef.current =
          streamRevealTargetCodePointsRef.current.length;
        streamRevealVisibleRef.current = immediateVisible;
        setStreamBuffer(immediateVisible);
        return;
      }
      if (shouldApplyCadence && timestamp < streamRevealNextAllowedAtRef.current) {
        pendingStreamRevealFrameRef.current = requestAnimationFrame(advance);
        return;
      }

      const targetCodePoints = streamRevealTargetCodePointsRef.current;
      const currentVisibleCount = streamRevealVisibleCodePointCountRef.current;
      const pendingCharacters = targetCodePoints.length - currentVisibleCount;
      if (pendingCharacters <= 0) {
        return;
      }

      const step = calculateStreamingRevealStep(pendingCharacters);
      const nextVisibleCount = Math.min(targetCodePoints.length, currentVisibleCount + step);
      const nextVisible = targetCodePoints.slice(0, nextVisibleCount).join('');
      streamRevealVisibleCodePointCountRef.current = nextVisibleCount;
      streamRevealVisibleRef.current = nextVisible;
      setStreamBuffer(nextVisible);

      const lastRevealedChar = targetCodePoints[nextVisibleCount - 1];
      streamRevealNextAllowedAtRef.current =
        timestamp + calculateStreamingRevealDelay(lastRevealedChar, pendingCharacters - step);

      if (nextVisibleCount < targetCodePoints.length) {
        pendingStreamRevealFrameRef.current = requestAnimationFrame(advance);
      }
    };
    pendingStreamRevealFrameRef.current = requestAnimationFrame(advance);
  }, []);

  return {
    streaming,
    setStreaming,
    stoppingStream,
    setStoppingStream,
    streamBuffer,
    setStreamBuffer,
    streamThinkingBuffer,
    setStreamThinkingBuffer,
    reportedStreamUsage,
    setReportedStreamUsage,
    recoveredStreamSnapshot,
    setRecoveredStreamSnapshot,
    activeStreamStartedAt,
    setActiveStreamStartedAt,
    activeStreamFirstTokenLatencyMs,
    setActiveStreamFirstTokenLatencyMs,
    streamError,
    setStreamError,

    streamingRef,
    stoppingStreamRef,
    currentAssistantStreamMessageIdRef,
    pendingStreamRevealFrameRef,
    streamRevealTargetRef,
    streamRevealVisibleRef,
    streamRevealTargetCodePointsRef,
    streamRevealVisibleCodePointCountRef,
    streamRevealNextAllowedAtRef,

    resetStreamState,
    scheduleStreamReveal,
    isImmediatelyRenderableStructuredContent: checkIsImmediatelyRenderableStructuredContent,
  };
}
