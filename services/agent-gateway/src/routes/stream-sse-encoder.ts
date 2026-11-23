/**
 * stream-sse-encoder.ts — SSE 协议编码与事件序列化
 *
 * 职责：
 * - SSE 事件编码（type/eventId/data）
 * - Cursor（seq）与客户端状态同步
 * - 事件序列号管理
 * - 特殊事件标记（accepted/route/error）
 *
 * 依赖：运行时类型、事件定义
 * 被依赖：stream.ts（run event 元信息与错误/受理/路由事件构造）
 */

import type { RunEvent, UpstreamStreamSummary } from '@openAwork/shared';
import { randomUUID } from 'node:crypto';

/** SSE 数据帧；事件 id/cursor 仍由各传输入口按既有协议处理。 */
export function encodeStreamEvent(event: RunEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * SSE 事件元信息（runId、序列号、时间戳）
 */
export interface RunEventMeta {
  eventId: string;
  runId: string;
  occurredAt: number;
}

/**
 * 客户端 cursor 信息：用于增量重连和事件去重
 */
export interface StreamCursor {
  clientRequestId: string;
  seq: number;
}

/**
 * 序列号计数器（可变对象，便于在主循环中更新）
 */
export interface EventSequence {
  value: number;
}

/**
 * 创建运行事件元信息（eventId + runId + 时间戳）
 *
 * @param runId - 本轮执行 ID
 * @param sequence - 序列号计数器（会自动递增）
 * @returns 运行事件元信息
 */
export function createRunEventMeta(runId: string, sequence: EventSequence): RunEventMeta {
  const eventId = `${runId}:evt:${sequence.value}`;
  sequence.value += 1;
  return {
    eventId,
    runId,
    occurredAt: Date.now(),
  };
}

/**
 * 创建 upstream route chunk（用于标记模型路由信息）
 *
 * @param input - 路由和运行信息
 * @returns 上游路由事件
 */
export function createUpstreamRouteChunk(input: {
  modelId: string;
  providerId?: string;
  providerType?: string;
  runId: string;
  sequence: EventSequence;
  requestId?: string;
}): Extract<RunEvent, { type: 'upstream_route' }> {
  const providerId = input.providerId ?? input.providerType;
  return {
    type: 'upstream_route' as const,
    modelId: input.modelId,
    ...(providerId ? { providerId } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...createRunEventMeta(input.runId, input.sequence),
  };
}

/**
 * 创建仅包含路由信息的上游摘要（无详细统计）
 *
 * @param input - 路由和停止原因
 * @returns 上游流摘要
 */
export function createRouteOnlyUpstreamSummary(input: {
  modelId?: string;
  providerId?: string;
  providerType?: string;
  stopReason: UpstreamStreamSummary['stopReason'];
}): UpstreamStreamSummary {
  const providerId = input.providerId ?? input.providerType;
  return {
    stopReason: input.stopReason,
    textDeltaCount: 0,
    reasoningDeltaCount: 0,
    toolCallDeltaCount: 0,
    ...(input.modelId ? { modelId: input.modelId } : {}),
    ...(providerId ? { providerId } : {}),
    sawDone: false,
    sawError: input.stopReason === 'error',
    stalled: input.stopReason === 'error',
  };
}

/**
 * 创建流式错误事件
 *
 * @param input - 错误详情
 * @returns 错误事件
 */
export function createStreamErrorEvent(input: {
  code: string;
  message: string;
  runId: string;
  upstreamSummary?: UpstreamStreamSummary;
  requestId?: string;
  technicalDetail?: string;
}): Extract<RunEvent, { type: 'error' }> {
  const normalizedTechnicalDetail = input.technicalDetail?.trim();
  return {
    type: 'error' as const,
    code: input.code,
    message: input.message,
    ...(normalizedTechnicalDetail ? { technicalDetail: normalizedTechnicalDetail } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    runId: input.runId,
    ...(input.upstreamSummary ? { upstreamSummary: input.upstreamSummary } : {}),
    eventId: `${input.runId}:error:${randomUUID()}`,
    occurredAt: Date.now(),
  };
}

/**
 * 创建流式错误事件（位置参数兼容包装，委托 `createStreamErrorEvent`）
 *
 * 之所以放在叶子模块而非 `stream.ts`：`stream-model-round.ts` 需要它，而它若定义在
 * `stream.ts` 会让 `stream.ts → stream-model-round.ts → stream.ts` 形成运行时循环依赖。
 * 移到这里后 `stream.ts` 仍以 re-export 保持对外导出名与签名不变。
 *
 * @returns 错误事件
 */
export function createStreamErrorChunk(
  code: string,
  message: string,
  runId: string,
  upstreamSummary?: UpstreamStreamSummary,
  requestId?: string,
  technicalDetail?: string,
): Extract<RunEvent, { type: 'error' }> {
  return createStreamErrorEvent({
    code,
    message,
    runId,
    upstreamSummary,
    requestId,
    technicalDetail,
  });
}

/**
 * 创建运行受理事件
 *
 * @param input - 受理信息
 * @returns 受理事件（不入库）
 */
export function createRunAcceptedEvent(input: { runId: string; requestId: string }): RunEvent {
  return {
    type: 'run_accepted' as const,
    occurredAt: Date.now(),
    requestId: input.requestId,
    runId: input.runId,
    eventId: `${input.runId}:accepted`,
  };
}
