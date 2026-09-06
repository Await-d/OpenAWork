export interface TextLineSelection {
  readonly lineCount: number;
  readonly output: string;
  readonly sliceEnd: number;
  readonly totalLines: number;
}

export function selectTextLines(
  text: string,
  requestedLineStart: number,
  requestedLineCount: number,
): TextLineSelection {
  const selected: string[] = [];
  let currentStart = 0;
  let currentLine = 1;
  for (let index = 0; index <= text.length; index += 1) {
    const atEnd = index === text.length;
    const atBreak = text.charCodeAt(index) === 10;
    if (!atEnd && !atBreak) continue;
    if (
      currentLine >= requestedLineStart &&
      currentLine < requestedLineStart + requestedLineCount
    ) {
      const contentEnd =
        index > currentStart && text.charCodeAt(index - 1) === 13 ? index - 1 : index;
      selected.push(text.slice(currentStart, contentEnd));
    }
    currentLine += 1;
    currentStart = index + 1;
  }
  const totalLines = text.length === 0 ? 1 : currentLine - 1;
  const availableStart = Math.min(totalLines + 1, requestedLineStart);
  const lineCount = Math.min(requestedLineCount, Math.max(0, totalLines - availableStart + 1));
  return {
    lineCount,
    output: selected.join('\n'),
    sliceEnd: availableStart + lineCount - 1,
    totalLines,
  };
}
