const CHANNEL_LLM_TOOL_KEYS = new Set(['web_search', 'read', 'edit', 'bash', 'mcp', 'task']);

export function hasEnabledChannelLlmTool(tools: Record<string, boolean> | undefined): boolean {
  return Object.entries(tools ?? {}).some(
    ([key, enabled]) => enabled && CHANNEL_LLM_TOOL_KEYS.has(key),
  );
}

export function resolveChannelLlmToolsEnabled(input: {
  readonly explicit?: boolean;
  readonly tools?: Record<string, boolean>;
  readonly fallback?: boolean;
}): boolean {
  if (typeof input.explicit === 'boolean') {
    return input.explicit;
  }

  if (hasEnabledChannelLlmTool(input.tools)) {
    return true;
  }

  return input.fallback === true;
}
