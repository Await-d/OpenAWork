import type { Message } from '@openAwork/opencode-llm';
import { ToolResultPart } from '@openAwork/opencode-llm';
import { projectToolOutput } from '../../message/tool-output-model-view.js';
import { buildToolOutputReferenceIdentity } from '../../message/tool-output-reference.js';
import { DEFAULT_TOOL_CONTEXT_POLICY } from '../../compaction/tool-context-policy.js';

export interface NativeToolContextGuardOptions {
  readonly maxTotalToolCostChars?: number;
}

export function guardNativeToolContext(
  messages: readonly Message[],
  options: NativeToolContextGuardOptions = {},
): Message[] {
  const projected = messages.map((message) => ({
    ...message,
    content: message.content.map((part) =>
      part.type === 'tool-result' && typeof part.result.value === 'string'
        ? ToolResultPart.make({
            ...part,
            result: projectToolOutput(part.id, part.result.value),
            resultType: part.result.type,
          })
        : part,
    ),
  }));
  const locations = projected.flatMap((message, messageIndex) =>
    message.content.flatMap((part, partIndex) =>
      part.type === 'tool-result'
        ? [{ messageIndex, partIndex, chars: String(part.result.value).length, part }]
        : [],
    ),
  );
  let retainedChars = locations.reduce((sum, location) => sum + location.chars, 0);
  const maxTotalToolCostChars =
    options.maxTotalToolCostChars ?? DEFAULT_TOOL_CONTEXT_POLICY.maxTotalToolCostChars;
  if (retainedChars <= maxTotalToolCostChars) return projected;

  const replacements = new Map<string, ReturnType<typeof ToolResultPart.make>>();
  for (const location of locations.slice(0, -1)) {
    if (retainedChars <= maxTotalToolCostChars) break;
    const reference = `[tool_output_reference] ${JSON.stringify({
      microcompacted: true,
      ...buildToolOutputReferenceIdentity(location.part.id),
      retrievalTool: 'read_tool_output',
    })}`;
    if (reference.length >= location.chars) continue;
    replacements.set(
      `${location.messageIndex}:${location.partIndex}`,
      ToolResultPart.make({
        ...location.part,
        result: reference,
        resultType: location.part.result.type,
      }),
    );
    retainedChars -= location.chars - reference.length;
  }
  return projected.map((message, messageIndex) => ({
    ...message,
    content: message.content.map(
      (part, partIndex) => replacements.get(`${messageIndex}:${partIndex}`) ?? part,
    ),
  }));
}
