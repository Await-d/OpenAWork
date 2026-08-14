/**
 * Session Interruption Detector
 *
 * 检测对话中断类型，用于自动恢复机制。
 *
 * 参考实现：
 * /home/await/project/OpenAWork/temp/claude-code-sourcemap/restored-src/src/utils/conversationRecovery.ts
 * (行 254-333: detectTurnInterruption 逻辑)
 */

import type { Message } from '@openAwork/shared';

export type InterruptionType = 'none' | 'interrupted_prompt' | 'interrupted_turn';

export interface InterruptionDetectionResult {
  kind: InterruptionType;
  /** 当 kind 为 interrupted_prompt 时，包含被中断的用户消息 */
  message?: Message;
}

/**
 * 检测对话是否被中断
 *
 * 中断类型：
 * - interrupted_prompt: 用户发送消息后，AI 未开始响应就被中断
 * - interrupted_turn: AI 响应过程中被中断（例如工具调用后无响应）
 * - none: 正常结束，无中断
 *
 * @param messages 消息列表（按时间顺序）
 * @returns 中断检测结果
 */
export function detectTurnInterruption(messages: Message[]): InterruptionDetectionResult {
  if (messages.length === 0) {
    return { kind: 'none' };
  }

  // 从后往前找最后一条相关消息，跳过系统消息和进度消息
  const lastMessageIdx = findLastRelevantMessageIndex(messages);
  if (lastMessageIdx === -1) {
    return { kind: 'none' };
  }

  const lastMessage = messages[lastMessageIdx]!;

  // 最后消息是 assistant → 正常结束
  if (lastMessage.role === 'assistant') {
    // Claude Code 参考实现中，流式输出的 stop_reason 在持久化时总是 null
    // 因此只要最后消息是 assistant，就认为是正常结束
    // 如果有未解析的 tool_use，应该在之前的过滤步骤中已被移除
    return { kind: 'none' };
  }

  // 最后消息是 user
  if (lastMessage.role === 'user') {
    // 检查是否为工具调用结果
    if (isToolResultMessage(lastMessage)) {
      // tool_result 后无 assistant 响应 → interrupted_turn
      // 但需要排除终端工具（Brief、SendUserFile）的特殊情况
      if (isTerminalToolResult(lastMessage, messages, lastMessageIdx)) {
        // Brief 模式下，SendUserFile 是合法的终止点
        return { kind: 'none' };
      }
      return { kind: 'interrupted_turn' };
    }

    // 纯文本用户消息，后面没有 assistant 响应 → interrupted_prompt
    return { kind: 'interrupted_prompt', message: lastMessage };
  }

  // 其他情况（理论上不应该到达）
  return { kind: 'none' };
}

/**
 * 从后往前查找最后一条相关消息的索引
 * 跳过系统消息、进度消息和 API 错误消息
 */
function findLastRelevantMessageIndex(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    // 跳过系统消息和进度消息
    if (msg.role === 'system') continue;
    // 跳过内部元数据消息（如果有的话）
    // @ts-expect-error - 可能存在的内部字段
    if (msg.isProgress || msg.isMeta) continue;
    return i;
  }
  return -1;
}

/**
 * 检查消息是否为工具调用结果
 */
function isToolResultMessage(message: Message): boolean {
  if (message.role !== 'user') return false;

  const content = message.content;
  if (typeof content === 'string') return false;
  if (!Array.isArray(content)) return false;

  // 检查是否包含 tool_result 类型的内容块
  return content.some((block) => {
    if (typeof block !== 'object' || !block) return false;
    return block.type === 'tool_result';
  });
}

/**
 * 检查工具调用结果是否为终端工具（Brief、SendUserFile）
 *
 * 这些工具在 Brief 模式下是合法的终止点，不应被视为中断
 */
function isTerminalToolResult(result: Message, messages: Message[], resultIdx: number): boolean {
  const content = result.content;
  if (!Array.isArray(content)) return false;

  const toolResultBlock = content.find((block) => block && block.type === 'tool_result');
  if (!toolResultBlock || typeof toolResultBlock !== 'object') return false;

  const toolUseId = (toolResultBlock as Record<string, unknown>).toolCallId as string | undefined;
  if (!toolUseId) return false;

  // 从当前位置往前查找对应的 tool_call
  for (let i = resultIdx - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.role !== 'assistant') continue;

    const assistantContent = msg.content;
    if (!Array.isArray(assistantContent)) continue;

    for (const block of assistantContent) {
      if (!block || typeof block !== 'object') continue;
      if (block.type !== 'tool_call') continue;

      const toolBlock = block as Record<string, unknown>;
      if (toolBlock.toolCallId === toolUseId) {
        const toolName = toolBlock.toolName as string;
        // 检查是否为终端工具
        return isTerminalToolName(toolName);
      }
    }
  }

  return false;
}

/**
 * 终端工具名称列表
 * Brief 模式下这些工具调用后不需要 assistant 文本响应
 */
const TERMINAL_TOOL_NAMES = [
  'brief', // Brief 工具（新版）
  'legacy_brief', // Brief 工具（旧版）
  'send_user_file', // SendUserFile 工具
];

function isTerminalToolName(toolName: string): boolean {
  return TERMINAL_TOOL_NAMES.includes(toolName.toLowerCase());
}
