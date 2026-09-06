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
const DEFAULT_MAX_TOTAL_TOOL_COST_CHARS = 48_000;
const TOOL_CONTEXT_WINDOW_RATIO = 0.25;

export const DEFAULT_TOOL_CONTEXT_POLICY: ToolContextPolicy = {
  charsPerToken: DEFAULT_CHARS_PER_TOKEN,
  estimatedImageTokens: 1_600,
  maxImagesPerToolResult: 4,
  maxInlineImageUrlChars: 500_000,
  maxReadPageBytes: 8_000,
  maxSingleToolTextChars: 8_192,
  maxTotalToolCostChars: DEFAULT_MAX_TOTAL_TOOL_COST_CHARS,
};

function usableContextWindow(input: ToolContextPolicyInput): number | undefined {
  const value = input.contextWindowOverrideTokens ?? input.contextWindowTokens;
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

export function resolveToolContextPolicy(input: ToolContextPolicyInput = {}): ToolContextPolicy {
  const contextWindow = usableContextWindow(input);
  const dynamicBudget =
    contextWindow === undefined
      ? DEFAULT_MAX_TOTAL_TOOL_COST_CHARS
      : Math.floor(contextWindow * TOOL_CONTEXT_WINDOW_RATIO * DEFAULT_CHARS_PER_TOKEN);
  return {
    ...DEFAULT_TOOL_CONTEXT_POLICY,
    maxTotalToolCostChars: Math.min(DEFAULT_MAX_TOTAL_TOOL_COST_CHARS, dynamicBudget),
  };
}
