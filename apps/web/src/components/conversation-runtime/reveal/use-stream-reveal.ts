import { useEffect, useRef } from 'react';
import { calculateStreamingRevealStep, calculateStreamingRevealDelay } from './streaming-reveal.js';
import type { StreamingThinkingBlock } from '../stream/streaming-thinking.js';
import type { ChatMessagePart } from '../messages/support.js';

/**
 * 流式可见文本的**提交**降频。
 *
 * reveal 的推进仍保持逐帧节奏（`calculateStreamingRevealDelay` 8–16ms），但把
 * `setStreamBuffer` 的提交合并到 24ms / 40ms 一次：每次提交都会触发一次 React
 * 整树协调 + 浏览器排版，文本越长单次越贵。短文本（≤6k）仍逐帧提交，逐字手感不变；
 * 长文本把提交频率压到 ~40fps / 25fps——视觉上仍是连续吐字，主线程占用却减半以上。
 *
 * 注意：`streamRevealVisibleRef` 的推进不受影响，提交只是"隔几帧刷一次"，因此
 * 落字内容不会落后或丢失（到达目标时强制提交，见 `advance`）。
 */
const REVEAL_COMMIT_DIRECT_MAX_CHARS = 6_000;
const REVEAL_COMMIT_INTERVAL_MS = 24;
const REVEAL_COMMIT_HEAVY_CHARS = 24_000;
const REVEAL_COMMIT_HEAVY_INTERVAL_MS = 40;

function resolveRevealCommitIntervalMs(visibleChars: number): number {
  if (visibleChars <= REVEAL_COMMIT_DIRECT_MAX_CHARS) {
    return 0;
  }
  return visibleChars >= REVEAL_COMMIT_HEAVY_CHARS
    ? REVEAL_COMMIT_HEAVY_INTERVAL_MS
    : REVEAL_COMMIT_INTERVAL_MS;
}

export interface StreamRevealSetters {
  setStreamBuffer: (value: string) => void;
  setStreamThinkingBuffer: (value: string) => void;
  setStreamThinkingBlocks: (value: StreamingThinkingBlock[]) => void;
  /** Clear the ordered streaming segment list when the stream resets. */
  setStreamingSegments: (value: ChatMessagePart[]) => void;
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
    setStreamThinkingBlocks,
    setStreamingSegments,
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
  /** 上一次真正提交 `setStreamBuffer` 的帧时间戳（见 `resolveRevealCommitIntervalMs`）。 */
  const lastCommitAtRef = useRef(0);

  // 普通箭头函数，不包 useCallback：手写 useCallback 会让 React Compiler 报
  // "Existing memoization could not be preserved" 并放弃优化本 hook
  // （实测本文件因此 1 个函数脱靶）。编译器会按真实依赖自动 memoize。
  const resetStreamState = () => {
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
    lastCommitAtRef.current = 0;
    setStreamBuffer('');
    setStreamThinkingBuffer('');
    setStreamThinkingBlocks([]);
    setStreamingSegments([]);
    setRecoveredStreamSnapshot(null);
    streamingRef.current = false;
    setStreaming(false);
    setStoppingStream(false);
    setActiveStreamStartedAt(null);
    setActiveStreamFirstTokenLatencyMs(null);
    currentAssistantStreamMessageIdRef.current = null;
  };

  const scheduleStreamReveal = () => {
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
        // 长文本降频提交：推进照常，只是隔几帧才刷新一次可见文本。
        // 到达目标时必须强制提交，否则最后一段字符会因为没有后续帧而丢失。
        const reachedTarget = nextVisibleCount >= targetCodePoints.length;
        const commitInterval = resolveRevealCommitIntervalMs(nextVisible.length);
        const canCommitByInterval =
          timestamp <= 0 ||
          commitInterval === 0 ||
          timestamp - lastCommitAtRef.current >= commitInterval;
        if (reachedTarget || canCommitByInterval) {
          lastCommitAtRef.current = timestamp;
          setters.setStreamBuffer(nextVisible);
        }
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
  };

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
