import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ChatMessagePart } from '../messages/support.js';
import type { StreamingThinkingBlock } from './streaming-thinking.js';

/**
 * 把高频流式状态 setter 合并为「每帧至多一次」提交。
 *
 * 背景：SSE token 逐条到达时，`useConversationStream` 会对每个 text/thinking
 * delta 直接调用 setter。React 的自动批处理只能合并同一回调内的 set，不同
 * 事件之间仍是一次 set 一次整树重渲染 —— 多会话并发时每秒会产生几十到几百
 * 次流式视图重渲染。
 *
 * 本 hook 把写入暂存到 ref（保留最后一次值），同一帧内的多次写入只调度一次
 * rAF；帧回调里按「文本 → 思考 → 分段」的顺序把各状态的最新值一次性提交给
 * 真实 setter，React 会把同回调内的多次 set 合并为一次渲染。
 *
 * 语义约束：
 * - 每次写入必须传入**完整最新值**（累计文本 / 完整 segments 等）；
 *   last-write-wins 合并才是安全的。updater 函数按「上次已提交值」解析；
 * - 同一状态的所有写入方必须共用本 hook 返回的 setter，绕过缓冲直接调用真实
 *   setter 会造成提交乱序（旧值覆盖新值）；
 * - 组件卸载时取消未触发的帧回调。
 */
export interface CoalescedStreamSettersInput {
  setStreamBuffer: Dispatch<SetStateAction<string>>;
  setStreamThinkingBuffer: Dispatch<SetStateAction<string>>;
  setStreamThinkingBlocks: Dispatch<SetStateAction<StreamingThinkingBlock[]>>;
  setStreamingSegments: Dispatch<SetStateAction<ChatMessagePart[]>>;
}

export type CoalescedStreamSetters = CoalescedStreamSettersInput;

interface PendingSlot<T> {
  /** 待提交的解析器：入参为上次已提交值，返回本次要提交的值。 */
  resolve: ((previous: T) => T) | null;
}

function toResolver<T>(value: SetStateAction<T>): (previous: T) => T {
  return typeof value === 'function' ? (value as (previous: T) => T) : () => value;
}

export function useCoalescedStreamSetters(
  input: CoalescedStreamSettersInput,
): CoalescedStreamSetters {
  const {
    setStreamBuffer,
    setStreamThinkingBuffer,
    setStreamThinkingBlocks,
    setStreamingSegments,
  } = input;

  const frameIdRef = useRef<number | null>(null);
  const scheduledRef = useRef(false);
  const pendingRef = useRef<{
    buffer: PendingSlot<string>;
    thinkingBuffer: PendingSlot<string>;
    thinkingBlocks: PendingSlot<StreamingThinkingBlock[]>;
    segments: PendingSlot<ChatMessagePart[]>;
  }>({
    buffer: { resolve: null },
    thinkingBuffer: { resolve: null },
    thinkingBlocks: { resolve: null },
    segments: { resolve: null },
  });
  const committedRef = useRef<{
    buffer: string;
    thinkingBuffer: string;
    thinkingBlocks: StreamingThinkingBlock[];
    segments: ChatMessagePart[];
  }>({
    buffer: '',
    thinkingBuffer: '',
    thinkingBlocks: [],
    segments: [],
  });

  const flush = useCallback(() => {
    scheduledRef.current = false;
    frameIdRef.current = null;
    const pending = pendingRef.current;
    const committed = committedRef.current;

    if (pending.thinkingBuffer.resolve !== null) {
      const resolve = pending.thinkingBuffer.resolve;
      pending.thinkingBuffer.resolve = null;
      const next = resolve(committed.thinkingBuffer);
      committed.thinkingBuffer = next;
      setStreamThinkingBuffer(next);
    }
    if (pending.thinkingBlocks.resolve !== null) {
      const resolve = pending.thinkingBlocks.resolve;
      pending.thinkingBlocks.resolve = null;
      const next = resolve(committed.thinkingBlocks);
      committed.thinkingBlocks = next;
      setStreamThinkingBlocks(next);
    }
    if (pending.segments.resolve !== null) {
      const resolve = pending.segments.resolve;
      pending.segments.resolve = null;
      const next = resolve(committed.segments);
      committed.segments = next;
      setStreamingSegments(next);
    }
    if (pending.buffer.resolve !== null) {
      const resolve = pending.buffer.resolve;
      pending.buffer.resolve = null;
      const next = resolve(committed.buffer);
      committed.buffer = next;
      setStreamBuffer(next);
    }
  }, [setStreamBuffer, setStreamThinkingBlocks, setStreamThinkingBuffer, setStreamingSegments]);

  const schedule = useCallback(() => {
    if (scheduledRef.current) {
      return;
    }
    scheduledRef.current = true;
    // 注意：调度标记与帧句柄分离。同步执行的 rAF 宿主（测试桩）会在
    // requestAnimationFrame 返回前跑完 flush，句柄赋值晚于 flush 的重置；
    // 若用「句柄非空」判断调度状态会被这次赋值永久卡住。
    frameIdRef.current = requestAnimationFrame(flush);
  }, [flush]);

  useEffect(
    () => () => {
      if (frameIdRef.current !== null) {
        cancelAnimationFrame(frameIdRef.current);
        frameIdRef.current = null;
      }
      scheduledRef.current = false;
      // 清理未提交的写入：即使宿主忽略了 cancel（或回调已在派发中），
      // 卸载后的残留帧回调也不会再触碰已卸载组件的 state。
      const pending = pendingRef.current;
      pending.buffer.resolve = null;
      pending.thinkingBuffer.resolve = null;
      pending.thinkingBlocks.resolve = null;
      pending.segments.resolve = null;
    },
    [],
  );

  return useMemo(
    () => ({
      setStreamBuffer: (value: SetStateAction<string>) => {
        pendingRef.current.buffer.resolve = toResolver(value);
        schedule();
      },
      setStreamThinkingBuffer: (value: SetStateAction<string>) => {
        pendingRef.current.thinkingBuffer.resolve = toResolver(value);
        schedule();
      },
      setStreamThinkingBlocks: (value: SetStateAction<StreamingThinkingBlock[]>) => {
        pendingRef.current.thinkingBlocks.resolve = toResolver(value);
        schedule();
      },
      setStreamingSegments: (value: SetStateAction<ChatMessagePart[]>) => {
        pendingRef.current.segments.resolve = toResolver(value);
        schedule();
      },
    }),
    [schedule],
  );
}
