export function buildLocalReasoningBlockKey(content: string, index: number): string {
  const stableSeed =
    content
      .replace(/\r\n?/gu, '\n')
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? 'reasoning';

  return `${stableSeed.slice(0, 48)}-${index}`;
}

export function getLocalReasoningLabel(options: {
  index: number;
  streaming: boolean;
  total: number;
}): string {
  const base = 'Thinking:';
  return options.total > 1 ? `${base} ${options.index + 1}` : base;
}

export function shouldStreamLocalReasoningBlock(options: {
  ended?: boolean;
  hasActiveToolCall: boolean;
  hasAssistantText: boolean;
  index: number;
  streaming: boolean;
  total: number;
}): boolean {
  if (!options.streaming || options.total <= 0) {
    return false;
  }

  if (options.ended) {
    return false;
  }

  if (options.hasAssistantText || options.hasActiveToolCall) {
    return false;
  }

  return options.index === options.total - 1;
}
