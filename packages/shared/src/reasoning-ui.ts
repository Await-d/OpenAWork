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

/** 单个思考块的展示态输入（展示层合并前的规范化形状）。 */
export interface ReasoningDisplayBlock {
  id: string;
  text: string;
  startedAt?: number;
  endedAt?: number;
  /** 该块是否已结束（thinking_end 已到）。展示层必须传已解析后的布尔值。 */
  ended?: boolean;
  durationMs?: number;
}

/** 一条消息内所有思考块合并后的展示形状。 */
export interface MergedReasoningDisplayBlock {
  id: string;
  text: string;
  /** 被合并的原始块数量。 */
  count: number;
  startedAt?: number;
  endedAt?: number;
  /** 仅当所有被合并块都已结束才为 true。 */
  ended: boolean;
  durationMs?: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 展示层专用：把一条消息内的多个思考块合并为一个展示块。
 * 纯函数，不修改入参，不影响消息本体 / 持久化 / 协议。
 * - text：非空文本按出现顺序用 '\n\n' 拼接
 * - ended：所有块 ended !== false 时为 true
 * - startedAt/endedAt：分别为最早 / 最晚的已知值
 * - durationMs：所有块都带已知 durationMs 时求和；否则回退到 endedAt - startedAt
 */
export function mergeReasoningDisplayBlocks(
  blocks: readonly ReasoningDisplayBlock[],
): MergedReasoningDisplayBlock | null {
  if (blocks.length === 0) {
    return null;
  }

  const first = blocks[0]!;
  const texts = blocks.map((block) => block.text).filter((text) => text.trim().length > 0);
  const startedCandidates = blocks
    .map((block) => block.startedAt)
    .filter((value): value is number => isFiniteNumber(value));
  const endedCandidates = blocks
    .map((block) => block.endedAt)
    .filter((value): value is number => isFiniteNumber(value));
  const durations = blocks
    .map((block) => block.durationMs)
    .filter((value): value is number => isFiniteNumber(value));

  const startedAt = startedCandidates.length > 0 ? Math.min(...startedCandidates) : undefined;
  const endedAt = endedCandidates.length > 0 ? Math.max(...endedCandidates) : undefined;
  const allDurationsKnown = durations.length === blocks.length;
  const durationMs = allDurationsKnown
    ? durations.reduce((sum, value) => sum + value, 0)
    : isFiniteNumber(startedAt) && isFiniteNumber(endedAt) && endedAt >= startedAt
      ? endedAt - startedAt
      : undefined;

  return {
    id: first.id,
    text: texts.join('\n\n'),
    count: blocks.length,
    ...(isFiniteNumber(startedAt) ? { startedAt } : {}),
    ...(isFiniteNumber(endedAt) ? { endedAt } : {}),
    ended: blocks.every((block) => block.ended !== false),
    ...(isFiniteNumber(durationMs) ? { durationMs } : {}),
  };
}
