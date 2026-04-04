export const REASONING_UI_TOKENS = {
  blockMarginBottomPx: 8,
  blockRadiusPx: 12,
  bodyFontSizePx: 13,
  bodyLineHeightPx: 20,
  bodyPaddingBottomPx: 12,
  bodyPaddingXPx: 12,
  headingFontSizePx: 12,
  headingLineHeightPx: 18,
  labelBadgeHeightPx: 20,
  labelBadgePaddingXPx: 8,
  labelBadgeRadiusPx: 999,
  hintFontSizePx: 11,
  hintLineHeightPx: 16,
  labelFontSizePx: 11,
  labelLetterSpacingPx: 0.5,
  previewMaxChars: 96,
  summaryGapPx: 12,
  summaryMainGapPx: 4,
  summaryPaddingXPx: 12,
  summaryPaddingYPx: 10,
} as const;

export const REASONING_COLOR_TOKENS = {
  bodyText: '#cbd5e1',
  headingText: '#94a3b8',
  hintText: '#64748b',
  labelText: '#cbd5e1',
  pressedBackground: '#172554',
  streamingBackground: '#111c34',
  streamingBorder: '#475569',
  surfaceBackground: '#0f172a',
  surfaceBorder: '#334155',
} as const;

export function buildReasoningBlockKey(content: string, index: number): string {
  const stableSeed =
    extractReasoningHeading(content) ??
    content
      .replace(/\r\n?/gu, '\n')
      .split('\n')
      .map((line) => cleanReasoningInlineText(line))
      .find((line) => line.length > 0) ??
    'reasoning';

  return `${stableSeed.slice(0, 48)}-${index}`;
}

export function cleanReasoningInlineText(value: string): string {
  return value
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1')
    .replace(/[*_~>#-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function extractReasoningHeading(text: string): string | null {
  const markdown = text.replace(/\r\n?/gu, '\n');
  const html = markdown.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/iu);
  if (html?.[1]) {
    return cleanReasoningInlineText(html[1].replace(/<[^>]+>/gu, ' '));
  }

  const atx = markdown.match(/^\s{0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/mu);
  if (atx?.[1]) {
    return cleanReasoningInlineText(atx[1]);
  }

  const setext = markdown.match(/^([^\n]+)\n(?:=+|-+)\s*$/mu);
  if (setext?.[1]) {
    return cleanReasoningInlineText(setext[1]);
  }

  const strong = markdown.match(/^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*$/mu);
  if (strong?.[1]) {
    return cleanReasoningInlineText(strong[1]);
  }

  return null;
}

export function extractReasoningPreview(text: string): string | null {
  const firstLine = text
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => cleanReasoningInlineText(line))
    .find((line) => line.length > 0);

  if (!firstLine) {
    return null;
  }

  return firstLine.length > REASONING_UI_TOKENS.previewMaxChars
    ? `${firstLine.slice(0, REASONING_UI_TOKENS.previewMaxChars - 1)}…`
    : firstLine;
}

export function getReasoningHint(options: {
  charCount: number;
  open: boolean;
  streaming: boolean;
}): string {
  if (options.open) {
    return `收起 · ${options.charCount} 字`;
  }

  return options.streaming ? '展开查看推理过程' : `展开 · ${options.charCount} 字`;
}

export function getReasoningLabel(options: {
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
