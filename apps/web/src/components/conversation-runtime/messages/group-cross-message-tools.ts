/**
 * 跨消息工具调用合并逻辑。
 *
 * 场景：当多条连续的 assistant 消息都只包含单个相同 groupKey 的工具调用时，
 * 可以将它们合并展示为一个工具组，避免重复的元数据行造成视觉断裂。
 *
 * 示例：
 * ```
 * Message 1: 只有 1 个 bash 工具调用
 * Message 2: 只有 1 个 bash 工具调用
 * Message 3: 只有 1 个 bash 工具调用
 * ```
 * → 合并为一个 "调用了 3 次 bash" 的工具组
 *
 * 规则：
 * - 只合并 assistant 消息
 * - 每条消息必须只包含工具调用内容（无文本、无推理块）
 * - 工具调用必须是 stable 状态（completed/failed，非 running/paused/approval-pending）
 * - 工具调用的 groupKey 必须相同（通过 resolveGroupKey 判断）
 * - 消息之间必须完全连续，无其他内容间隔
 */

import type { AssistantTraceToolCall } from '@openAwork/shared';
import type { ChatMessage } from './support.js';
import { readAssistantTracePayload } from './support.js';
import { resolveGroupKey } from '../../chat/tool-call/shared/group-consecutive-tools.js';

interface ToolCallMergeCandidate {
  messageId: string;
  messageIndex: number;
  toolCall: AssistantTraceToolCall;
  groupKey: string;
}

function isStableToolCall(call: AssistantTraceToolCall): boolean {
  const status = call.status ?? 'completed';
  if (status === 'running' || status === 'paused') return false;
  if (call.pendingPermissionRequestId) return false;
  return true;
}

/**
 * 检测一条消息是否是"纯工具调用消息"（只包含单个工具调用，无文本/推理块）
 */
function extractSingleToolCallCandidate(
  message: ChatMessage,
  messageIndex: number,
): ToolCallMergeCandidate | null {
  if (message.role !== 'assistant') return null;
  if (message.status === 'streaming' || message.status === 'cancelled') return null;

  const payload = readAssistantTracePayload(message);
  if (!payload) return null;

  // 必须没有文本内容
  if (payload.text && payload.text.trim().length > 0) return null;

  // 必须没有推理块
  if (payload.reasoningBlocks && payload.reasoningBlocks.length > 0) return null;

  // 必须恰好包含 1 个工具调用
  if (payload.toolCalls.length !== 1) return null;

  const toolCall = payload.toolCalls[0];
  if (!toolCall || !isStableToolCall(toolCall)) return null;

  const groupKey = resolveGroupKey(toolCall.toolName, toolCall.kind);
  if (!groupKey) return null;

  return {
    messageId: message.id,
    messageIndex,
    toolCall,
    groupKey,
  };
}

/**
 * 从消息序列中识别可合并的工具调用分组。
 *
 * 返回一个 Map，key 是"合并组的首条消息索引"，value 是该组包含的所有消息索引。
 * 例如：Map { 2 => [2, 3, 4] } 表示索引 2/3/4 的三条消息应该合并展示。
 */
export function detectCrossMessageToolGroups(
  messages: readonly ChatMessage[],
): ReadonlyMap<number, readonly number[]> {
  const result = new Map<number, number[]>();
  const candidates: ToolCallMergeCandidate[] = [];

  // 第一步：提取所有候选
  for (let i = 0; i < messages.length; i++) {
    const candidate = extractSingleToolCallCandidate(messages[i]!, i);
    if (candidate) {
      candidates.push(candidate);
    }
  }

  if (candidates.length < 2) return result;

  // 第二步：识别连续的相同 groupKey 序列
  let groupStart = 0;
  while (groupStart < candidates.length) {
    const startCandidate = candidates[groupStart]!;
    let groupEnd = groupStart + 1;

    // 向后扫描，找到所有连续且 groupKey 相同的候选
    while (groupEnd < candidates.length) {
      const current = candidates[groupEnd]!;
      const prev = candidates[groupEnd - 1]!;

      // 检查消息索引是否连续
      if (current.messageIndex !== prev.messageIndex + 1) break;

      // 检查 groupKey 是否相同
      if (current.groupKey !== startCandidate.groupKey) break;

      groupEnd++;
    }

    const groupLength = groupEnd - groupStart;

    // 只有 >=2 条消息才值得合并
    if (groupLength >= 2) {
      const indices = candidates.slice(groupStart, groupEnd).map((c) => c.messageIndex);
      result.set(indices[0]!, indices);
    }

    groupStart = groupEnd;
  }

  return result;
}

/**
 * 判断某条消息是否应该被合并显示（即：它不是合并组的首条，应该被隐藏）
 */
export function shouldHideMessageInToolGroup(
  messageIndex: number,
  toolGroups: ReadonlyMap<number, readonly number[]>,
): boolean {
  for (const [groupStart, indices] of toolGroups.entries()) {
    if (messageIndex === groupStart) return false; // 首条消息保留
    if (indices.includes(messageIndex)) return true; // 非首条消息隐藏
  }
  return false;
}

/**
 * 获取某条消息应该渲染的所有工具调用（包括合并进来的）
 */
export function getToolCallsForMessage(
  messageIndex: number,
  messages: readonly ChatMessage[],
  toolGroups: ReadonlyMap<number, readonly number[]>,
): AssistantTraceToolCall[] {
  const indices = toolGroups.get(messageIndex);

  // 如果这条消息不是合并组的开头，返回空数组（不应该被调用）
  if (!indices) {
    const message = messages[messageIndex];
    if (!message) return [];
    const payload = readAssistantTracePayload(message);
    return payload?.toolCalls ?? [];
  }

  // 收集所有合并消息的工具调用
  const allToolCalls: AssistantTraceToolCall[] = [];
  for (const idx of indices) {
    const message = messages[idx];
    if (!message) continue;
    const payload = readAssistantTracePayload(message);
    if (payload?.toolCalls) {
      allToolCalls.push(...payload.toolCalls);
    }
  }

  return allToolCalls;
}
