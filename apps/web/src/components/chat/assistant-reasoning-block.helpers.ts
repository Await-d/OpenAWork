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
  excerptMaxChars: 160,
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

export function extractLocalReasoningExcerpt(text: string): string | null {
  const heading = extractLocalReasoningHeading(text);
  const lines = text
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => cleanLocalReasoningInlineText(line))
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return null;
  }

  const previewLines = heading
    ? lines[0] === heading
      ? lines.slice(1, 3)
      : lines.slice(0, Math.min(lines.length, 2))
    : lines.slice(1, 3);

  if (previewLines.length === 0) {
    return heading ?? lines[0] ?? null;
  }

  const excerpt = previewLines.join(' · ');
  return excerpt.length > LOCAL_REASONING_UI_TOKENS.excerptMaxChars
    ? `${excerpt.slice(0, LOCAL_REASONING_UI_TOKENS.excerptMaxChars - 1)}…`
    : excerpt;
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
  const base = 'Thinking:';
  return options.total > 1 ? `${base} ${options.index + 1}` : base;
}

export function getLocalReasoningHint(options: {
  charCount: number;
  open: boolean;
  streaming: boolean;
}): string {
  if (options.streaming) {
    return options.open ? '持续更新中 · 点击收起' : '已显示摘要 · 点击展开';
  }

  if (options.open) {
    return `收起 · ${options.charCount} 字`;
  }

  return `已显示摘要 · ${options.charCount} 字`;
}
