import { KeywordDetectorImpl } from '@openAwork/agent-core';

export const TOOL_OUTPUT_REFERENCE_SYSTEM_PROMPT =
  '当历史中出现 [tool_output_reference] 时，表示先前工具输出的完整结果仍然保存在当前会话里，但为了避免上下文膨胀，没有把全文重新塞进提示词。此时不要基于引用猜测细节；如果后续推理需要真实内容，优先调用 read_tool_output，并尽量用 toolCallId 配合 lineStart/lineCount、jsonPath 或 itemStart/itemCount 做定向读取。';

export function buildRequestScopedSystemPrompts(
  message: string,
  capabilityContext: string,
): string[] {
  const detector = new KeywordDetectorImpl();
  const detection = detector.detect(message);
  return [detection.injectedPrompt, capabilityContext].filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );
}

export function buildRoundSystemMessages(input: {
  workspaceCtx: string | null;
  routeSystemPrompt?: string;
  requestSystemPrompts: string[];
  shouldGuideToolOutputReadback: boolean;
}) {
  return [
    ...(input.workspaceCtx ? [{ role: 'system' as const, content: input.workspaceCtx }] : []),
    ...(input.routeSystemPrompt
      ? [{ role: 'system' as const, content: input.routeSystemPrompt }]
      : []),
    ...input.requestSystemPrompts.map((content) => ({ role: 'system' as const, content })),
    ...(input.shouldGuideToolOutputReadback
      ? [{ role: 'system' as const, content: TOOL_OUTPUT_REFERENCE_SYSTEM_PROMPT }]
      : []),
  ];
}
