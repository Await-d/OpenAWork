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
