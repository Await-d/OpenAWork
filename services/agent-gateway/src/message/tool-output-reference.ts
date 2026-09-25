import { createHash } from 'node:crypto';

const MAX_INLINE_REFERENCE_ID_CHARS = 256;

export function buildToolOutputReferenceIdentity(
  toolCallId: string,
): { readonly toolCallId: string } | { readonly toolCallRef: string } {
  if (toolCallId.length <= MAX_INLINE_REFERENCE_ID_CHARS) return { toolCallId };
  return {
    toolCallRef: createHash('sha256').update(toolCallId).digest('hex'),
  };
}

/**
 * 已微压缩工具结果的**唯一**模型可见形态。
 *
 * 这是 prompt-cache 的关键不变量：渲染期剪枝（microcompact）与持久化标记
 * （`time.compacted`）必须产出**逐字节相同**的字符串，否则同一批消息会在
 * 「剪枝轮」和「标记生效的下一轮」被改写两次，每次都打断缓存前缀。
 * 因此该形态只能依赖 toolCallId（不能带 preview / 图片数量等剪枝期上下文）。
 */
export function buildMicrocompactedToolOutputReference(toolCallId: string): string {
  return `[tool_output_reference] ${JSON.stringify({
    microcompacted: true,
    ...buildToolOutputReferenceIdentity(toolCallId),
    retrievalTool: 'read_tool_output',
  })}`;
}

/** 判断模型可见内容是否已是微压缩引用（两种写法都应命中）。 */
export function isMicrocompactedToolOutputReference(content: string): boolean {
  return (
    content.startsWith('[tool_output_reference]') || content === '[Old tool result content cleared]'
  );
}

export function matchesToolOutputReference(toolCallId: string, toolCallRef: string): boolean {
  if (toolCallId.length <= MAX_INLINE_REFERENCE_ID_CHARS) return false;
  return createHash('sha256').update(toolCallId).digest('hex') === toolCallRef;
}
