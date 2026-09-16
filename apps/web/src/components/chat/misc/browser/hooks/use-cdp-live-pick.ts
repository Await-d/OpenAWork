/**
 * CDP 实时预览的元素拾取接线。
 *
 * 武装后：
 * - 下一次点击（设备坐标）不作为普通输入下发，而是发 `{ ch: 'control', action }`；
 *   默认动作为 `pick`（回包携带元素信息与选择器），检查器取完整计算样式时用
 *   `node.styles`（同一个 `node` 回包，但额外带 `fullComputedStyles`，且不写 composer）。
 *   请求发出即回调 `onPickSent`（宿主持有坐标并解除武装；拾取是「单次」的）。
 * - **结果订阅不能只挂在 `armed` 上**：宿主在请求发出后立刻解除武装，而 `node`
 *   信封要等一个往返才回来。这里用「武装中 ∨ 结果在途」决定订阅存活，否则结果
 *   会被静默丢弃。
 * - `Esc` 取消拾取：在窗口捕获阶段吞掉事件，既解除武装，也不把 Esc 注入远端页面。
 *
 * 单次语义：结果在途时 `handlePick` 直接拒绝，保证一次拾取只发一条请求；
 * 结果超时未回则解除等待，用户可重新武装再试。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BrowserLiveNodePayload } from '@openAwork/shared';

import { insertTextIntoComposer } from '../browser-clipboard.js';
import { nodePayloadToMarkdown } from '../live-console-bridge.js';
import type { BrowserLiveSession } from './use-browser-live-session.js';

/** 拾取请求在途的兜底时限：超时未回 `node` 就解除等待，避免永远卡住。 */
export const PICK_RESULT_TIMEOUT_MS = 5_000;

/** 拾取结果反馈的展示时长（非阻塞提示，自动消失）。 */
export const PICK_FEEDBACK_DURATION_MS = 2_600;

/** 一次拾取的设备坐标。 */
export interface CdpLivePickPoint {
  x: number;
  y: number;
}

/** 拾取完成后的临时反馈，供宿主机渲染（不参与输入框内容）。 */
export interface CdpLivePickFeedback {
  tone: 'success' | 'warning';
  /** 服务端解析出的选择器（原样透传，展示端自行截断）。 */
  selector: string;
  /** `selectorUnique === false`：选择器可能命中多个元素。 */
  ambiguous: boolean;
}

export interface UseCdpLivePickOptions {
  session: BrowserLiveSession;
  /** 是否处于拾取模式；未武装时点击不参与拾取。 */
  armed: boolean;
  /** 命中结果的消费方；缺省按 `insertIntoComposer` 决定是否插入 composer。 */
  onResult?: (markdown: string) => void;
  /** 拾取请求已发出（宿主据此解除武装并记录坐标）。 */
  onPickSent?: (point: CdpLivePickPoint) => void;
  /** Esc 取消拾取（宿主据此解除武装）。 */
  onDisarm?: () => void;
  /** 拾取时下发的控制动作；缺省 `pick`。 */
  action?: 'pick' | 'node.styles';
  /** 是否把命中结果插入 composer；缺省 true（检查器取样式时应传 false，避免污染输入框）。 */
  insertIntoComposer?: boolean;
}

export interface CdpLivePick {
  /** 处理一次点击（设备坐标）；返回 true 表示该点击已被拾取消费。 */
  handlePick: (x: number, y: number) => boolean;
  /** 最近一次拾取结果；短暂展示后自动清空。 */
  feedback: CdpLivePickFeedback | null;
}

export function useCdpLivePick({
  session,
  armed,
  onResult,
  onPickSent,
  onDisarm,
  action = 'pick',
  insertIntoComposer = true,
}: UseCdpLivePickOptions): CdpLivePick {
  const { send, subscribe } = session;

  const [awaitingResult, setAwaitingResult] = useState(false);
  const [feedback, setFeedback] = useState<CdpLivePickFeedback | null>(null);
  /** 结果在途标记：订阅回调同步可读，不依赖 state 的渲染时机。 */
  const awaitingRef = useRef(false);
  const resultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearResultTimer = (): void => {
    if (resultTimerRef.current === null) return;
    clearTimeout(resultTimerRef.current);
    resultTimerRef.current = null;
  };

  const clearFeedbackTimer = (): void => {
    if (feedbackTimerRef.current === null) return;
    clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = null;
  };

  // 订阅存活条件：武装中（等待点击）或结果在途（请求已发、node 未回）。
  useEffect(() => {
    if (!armed && !awaitingResult) return;
    return subscribe((envelope) => {
      if (envelope.ch !== 'node') return;
      if (!awaitingRef.current) return;
      const payload = envelope.payload as BrowserLiveNodePayload;
      if (typeof payload?.selector !== 'string' || payload.selector.length === 0) return;

      awaitingRef.current = false;
      setAwaitingResult(false);
      clearResultTimer();

      const markdown = nodePayloadToMarkdown(payload);
      if (markdown.length === 0) return;

      if (onResult !== undefined) {
        onResult(markdown);
      } else if (insertIntoComposer) {
        insertTextIntoComposer(markdown);
      }

      setFeedback({
        tone: payload.selectorUnique === false ? 'warning' : 'success',
        selector: payload.selector,
        ambiguous: payload.selectorUnique === false,
      });
      clearFeedbackTimer();
      feedbackTimerRef.current = setTimeout(() => {
        feedbackTimerRef.current = null;
        setFeedback(null);
      }, PICK_FEEDBACK_DURATION_MS);
    });
  }, [armed, awaitingResult, subscribe, onResult, insertIntoComposer]);

  // Esc 取消拾取：捕获阶段拦截，避免引擎的键盘处理器把 Esc 注入远端页面。
  useEffect(() => {
    if (!armed) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onDisarm?.();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [armed, onDisarm]);

  // 卸载清理：在途等待与反馈定时器都不能泄漏。
  useEffect(() => {
    return () => {
      clearResultTimer();
      clearFeedbackTimer();
    };
  }, []);

  const handlePick = useCallback(
    (x: number, y: number): boolean => {
      // 结果在途时拒绝第二次点击：一次拾取只发一条 `pick`。
      if (!armed || awaitingRef.current) return false;

      awaitingRef.current = true;
      setAwaitingResult(true);
      setFeedback(null);
      clearFeedbackTimer();
      clearResultTimer();
      resultTimerRef.current = setTimeout(() => {
        resultTimerRef.current = null;
        awaitingRef.current = false;
        setAwaitingResult(false);
      }, PICK_RESULT_TIMEOUT_MS);

      send({ ch: 'control', action, x, y });
      onPickSent?.({ x, y });
      return true;
    },
    [armed, send, onPickSent, action],
  );

  return useMemo(() => ({ handlePick, feedback }), [handlePick, feedback]);
}
