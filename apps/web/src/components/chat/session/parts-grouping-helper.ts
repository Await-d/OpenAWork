import type {
  ChatToolPart,
  ChatReasoningPart,
  ChatMessagePart,
} from '../../conversation-runtime/messages/support.js';
import { groupConsecutiveTools } from '../tool-call/shared/group-consecutive-tools.js';

/**
 * 将 parts 数组转换为支持工具分组的渲染序列。
 * 连续的 tool parts 会通过 groupConsecutiveTools 合并成 single/group 条目——
 * 分组以 groupKey（如 'mcp'、'lsp'、'read'）为准，而不是精确的 toolName，
 * 因此连续调用的多个*不同* MCP 工具（mcp_sequential_thinking 后面跟
 * mcp_filesystem_read）也会合并成一个 "调用了 N 次 MCP 工具" 分组。
 */
export type GroupedPart =
  | { type: 'reasoning'; part: ChatReasoningPart }
  | { type: 'text'; part: { type: 'text'; id: string; text: string } }
  | { type: 'event'; part: { type: 'event'; id: string; payload: any } }
  | { type: 'tool-single'; part: ChatToolPart }
  | {
      type: 'tool-group';
      groupKey: string;
      toolName: string;
      calls: ChatToolPart[];
      startIndex: number;
    };

export function groupMessageParts(parts: readonly ChatMessagePart[]): GroupedPart[] {
  const result: GroupedPart[] = [];
  let i = 0;

  while (i < parts.length) {
    const part = parts[i];
    if (!part) {
      i++;
      continue;
    }

    if (part.type === 'reasoning') {
      result.push({ type: 'reasoning', part });
      i++;
    } else if (part.type === 'text') {
      result.push({ type: 'text', part });
      i++;
    } else if (part.type === 'event') {
      result.push({ type: 'event', part });
      i++;
    } else if (part.type === 'tool') {
      // 收集连续的 tool parts
      let j = i;
      while (j < parts.length && parts[j]?.type === 'tool') {
        j++;
      }
      const toolParts = parts.slice(i, j).filter((p): p is ChatToolPart => p?.type === 'tool');

      // 转换为 AssistantTraceToolCall[] 格式供 groupConsecutiveTools 使用
      const toolCalls = toolParts.map((tp) => ({
        toolCallId: tp.toolCallId,
        toolName: tp.toolName,
        input: tp.input,
        output: tp.output,
        isError: tp.isError,
        kind: tp.kind,
        status: tp.status,
        durationMs: tp.durationMs,
        pendingPermissionRequestId: tp.pendingPermissionRequestId,
        resumedAfterApproval: tp.resumedAfterApproval,
      }));

      const grouped = groupConsecutiveTools(toolCalls);

      for (const entry of grouped) {
        if (entry.kind === 'group') {
          result.push({
            type: 'tool-group',
            groupKey: entry.groupKey,
            toolName: entry.toolName,
            calls: toolParts.slice(entry.startIndex, entry.startIndex + entry.calls.length),
            startIndex: entry.startIndex,
          });
        } else {
          const toolPart = toolParts[entry.index];
          if (toolPart) {
            result.push({ type: 'tool-single', part: toolPart });
          }
        }
      }

      i = j;
    } else {
      i++;
    }
  }

  return result;
}
