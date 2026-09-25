import type { RunEvent } from '@openAwork/shared';

/**
 * 单条可流式工具（bash）的实时输出通道。
 *
 * 把滚动 stdout 以「单元素 `subTools`」形态复用 `tool_progress` 事件：前端
 * `applyStreamToolProgress` 会把它写进 live tool call 的 `_batchProgress`，
 * `BlockToolCall` 据此渲染实时终端（与 batch 子行同源、同一份数据契约）。
 *
 * 节流由 bash 工具侧负责（80ms 窗口 + 尾包，见 `tools/bash-tools.ts`），这里
 * 不做二次缓冲以免增加延迟。
 */
export function buildSingleToolPartialOutputWriter(input: {
  clientRequestId?: string;
  toolCallId: string;
  toolName: string;
  writeChunk: (chunk: RunEvent) => void;
}): (text: string) => void {
  const { clientRequestId, toolCallId, toolName, writeChunk } = input;
  return (text: string) => {
    writeChunk({
      type: 'tool_progress',
      toolCallId,
      toolName,
      subTools: [{ index: 0, tool: toolName, status: 'running', partialOutput: text }],
      completedCount: 0,
      totalCount: 1,
      ...(clientRequestId ? { clientRequestId } : {}),
      occurredAt: Date.now(),
    });
  };
}
