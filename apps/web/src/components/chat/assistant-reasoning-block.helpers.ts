export const LOCAL_REASONING_UI_TOKENS = {
  blockMarginBottomPx: 8,
  blockRadiusPx: 12,
  bodyFontSizePx: 13,
  bodyLineHeightPx: 20,
  bodyPaddingBottomPx: 12,
  bodyPaddingXPx: 12,
  headingFontSizePx: 12,
  headingLineHeightPx: 18,
  hintFontSizePx: 11,
  hintLineHeightPx: 16,
  labelBadgeHeightPx: 20,
  labelBadgePaddingXPx: 8,
  labelBadgeRadiusPx: 999,
  labelFontSizePx: 11,
  labelLetterSpacingPx: 0.5,
  previewMaxChars: 96,
  summaryGapPx: 12,
  summaryMainGapPx: 4,
  summaryPaddingXPx: 12,
  summaryPaddingYPx: 10,
} as const;

export function buildLocalReasoningBlockKey(content: string, index: number): string {
  const stableSeed =
    extractLocalReasoningHeading(content) ??
    content
      .replace(/\r\n?/gu, '\n')
      .split('\n')
      .map((line) => cleanLocalReasoningInlineText(line))
      .find((line) => line.length > 0) ??
    'reasoning';

  return `${stableSeed.slice(0, 48)}-${index}`;
}

export function extractLocalReasoningHeading(text: string): string | null {
  const markdown = text.replace(/\r\n?/gu, '\n');
  const html = markdown.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/iu);
  if (html?.[1]) {
    return cleanLocalReasoningInlineText(html[1].replace(/<[^>]+>/gu, ' '));
  }

  const atx = markdown.match(/^\s{0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/mu);
  if (atx?.[1]) {
    return cleanLocalReasoningInlineText(atx[1]);
  }

  const setext = markdown.match(/^([^\n]+)\n(?:=+|-+)\s*$/mu);
  if (setext?.[1]) {
    return cleanLocalReasoningInlineText(setext[1]);
  }

  const strong = markdown.match(/^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*$/mu);
  if (strong?.[1]) {
    return cleanLocalReasoningInlineText(strong[1]);
  }

  return null;
}

export function extractLocalReasoningPreview(text: string): string | null {
  const firstLine = text
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => cleanLocalReasoningInlineText(line))
    .find((line) => line.length > 0);

  if (!firstLine) {
    return null;
  }

  return firstLine.length > LOCAL_REASONING_UI_TOKENS.previewMaxChars
    ? `${firstLine.slice(0, LOCAL_REASONING_UI_TOKENS.previewMaxChars - 1)}…`
    : firstLine;
}

export function cleanLocalReasoningInlineText(value: string): string {
  return value
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/\[([^\]]+)\]\([^\)]+\)/gu, '$1')
    .replace(/[*_~>#-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function getLocalReasoningLabel(options: {
  index: number;
  streaming: boolean;
  total: number;
}): string {
  return options.total > 1
    ? `思考内容 ${options.index + 1}`
    : options.streaming
      ? '思考中'
      : '思考内容';
}

export function getLocalReasoningHint(options: {
  charCount: number;
  open: boolean;
  streaming: boolean;
}): string {
  if (options.open) {
    return `收起 · ${options.charCount} 字`;
  }

  return options.streaming ? '展开查看推理过程' : `展开 · ${options.charCount} 字`;
}
