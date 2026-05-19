export interface StreamingMarkdownSegments {
  activeTail: string;
  stableBlocks: string[];
}

export function splitStreamingMarkdownIntoSegments(content: string): StreamingMarkdownSegments {
  const normalized = content.replace(/\r\n/g, '\n');
  if (normalized.length === 0) {
    return { activeTail: '', stableBlocks: [] };
  }

  const lines = normalized.split('\n');
  const stableBlocks: string[] = [];
  let blockLines: string[] = [];
  let inFence = false;

  const flushStableBlock = () => {
    const normalizedLines = [...blockLines];
    while (
      normalizedLines.length > 0 &&
      normalizedLines[normalizedLines.length - 1]?.trim() === ''
    ) {
      normalizedLines.pop();
    }
    const nextBlock = normalizedLines.join('\n');
    if (nextBlock.length > 0) {
      stableBlocks.push(nextBlock);
    }
    blockLines = [];
  };

  lines.forEach((line) => {
    blockLines.push(line);
    const trimmed = line.trim();

    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence;
      if (!inFence) {
        flushStableBlock();
      }
      return;
    }

    if (!inFence && trimmed.length === 0) {
      flushStableBlock();
    }
  });

  return {
    activeTail: blockLines.join('\n'),
    stableBlocks,
  };
}
