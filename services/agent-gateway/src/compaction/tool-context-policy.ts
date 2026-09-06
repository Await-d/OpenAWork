export interface ToolContextPolicy {
  readonly charsPerToken: number;
  readonly estimatedImageTokens: number;
  readonly maxImagesPerToolResult: number;
  readonly maxInlineImageUrlChars: number;
  readonly maxReadPageBytes: number;
  readonly maxSingleToolTextChars: number;
  readonly maxTotalToolCostChars: number;
}

export interface ToolContextPolicyInput {
  readonly contextWindowOverrideTokens?: number;
  readonly contextWindowTokens?: number;
}

const DEFAULT_CHARS_PER_TOKEN = 4;
const UNBOUNDED_TOOL_CONTEXT_CHARS = Number.POSITIVE_INFINITY;

export const DEFAULT_TOOL_CONTEXT_POLICY: ToolContextPolicy = {
  charsPerToken: DEFAULT_CHARS_PER_TOKEN,
  estimatedImageTokens: 1_600,
  maxImagesPerToolResult: 4,
  maxInlineImageUrlChars: 500_000,
  maxReadPageBytes: 8_000,
  maxSingleToolTextChars: 8_192,
  maxTotalToolCostChars: UNBOUNDED_TOOL_CONTEXT_CHARS,
};

export function resolveToolContextPolicy(_input: ToolContextPolicyInput = {}): ToolContextPolicy {
  return DEFAULT_TOOL_CONTEXT_POLICY;
}
