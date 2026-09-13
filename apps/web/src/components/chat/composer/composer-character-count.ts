const DEFAULT_CHARACTER_LIMIT = 8000;
const MIN_CHARACTER_LIMIT = 500;
const CHARS_PER_TOKEN_ESTIMATE = 4;
const WARNING_RATIO = 0.8;

export type ComposerCharacterTone = 'normal' | 'warning' | 'danger';

export interface ComposerCharacterCount {
  readonly count: number;
  readonly limit: number;
  readonly tone: ComposerCharacterTone;
  readonly label: string;
  /** 按中英文字符加权的 token 估算量。 */
  readonly estimatedTokens: number;
  /** 当前模型的上下文窗口；未提供预算时为 null。 */
  readonly contextMaxTokens: number | null;
}

/**
 * 判断码点是否属于「一个字符 ≈ 一个 token」的表意文字 / 全角区段。
 *
 * 主流分词器下这类字符的 token 密度远高于拉丁字母（约 1 字 1 token），
 * 而拉丁字母约 4 字符才合 1 token。若统一按 4 字符折算，中文输入量会被
 * 低估约 4 倍，导致计数条的告警阈值与真实上下文占用完全脱钩。
 */
function isDenseScriptCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x11ff) || // 谚文字母
    (codePoint >= 0x2e80 && codePoint <= 0x303f) || // CJK 部首与符号
    (codePoint >= 0x3040 && codePoint <= 0x30ff) || // 平假名 / 片假名
    (codePoint >= 0x3130 && codePoint <= 0x318f) || // 谚文兼容字母
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) || // CJK 统一表意扩展 A
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) || // CJK 统一表意
    (codePoint >= 0xa960 && codePoint <= 0xa97f) || // 谚文字母扩展 A
    (codePoint >= 0xac00 && codePoint <= 0xd7ff) || // 谚文音节
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK 兼容表意
    (codePoint >= 0xfe10 && codePoint <= 0xfe6f) || // 竖排与兼容标点
    (codePoint >= 0xff00 && codePoint <= 0xffef) || // 全角形式
    (codePoint >= 0x20000 && codePoint <= 0x3ffff) // CJK 扩展 B 及以上
  );
}

/**
 * 估算输入文本的 token 量。
 *
 * 仅用于输入框的即时反馈，因此刻意保持零依赖、纯函数：表意文字计 4 个权重、
 * 其余字符计 1 个权重，再统一除以 4。与运行时统计用的
 * `estimateTokenCount`（对消息全文的粗估）职责不同，不共用实现。
 */
export function estimateComposerTokens(text: string): number {
  let weightedLength = 0;
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    weightedLength += isDenseScriptCodePoint(codePoint) ? CHARS_PER_TOKEN_ESTIMATE : 1;
  }
  return weightedLength === 0 ? 0 : Math.ceil(weightedLength / CHARS_PER_TOKEN_ESTIMATE);
}

function formatTokenBudget(contextMaxTokens: number): string {
  if (contextMaxTokens < 1000) {
    return contextMaxTokens.toLocaleString();
  }
  const thousands = contextMaxTokens / 1000;
  return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}k`;
}

export function getComposerCharacterLimit(contextMaxTokens?: number): number {
  if (contextMaxTokens === undefined || contextMaxTokens <= 0) {
    return DEFAULT_CHARACTER_LIMIT;
  }
  return Math.max(MIN_CHARACTER_LIMIT, Math.round(contextMaxTokens / CHARS_PER_TOKEN_ESTIMATE));
}

export function getComposerCharacterCount(
  text: string,
  contextMaxTokens?: number,
): ComposerCharacterCount {
  const contextBudget =
    contextMaxTokens !== undefined && contextMaxTokens > 0 ? contextMaxTokens : null;
  const count = text.length;
  const limit = getComposerCharacterLimit(contextBudget ?? undefined);
  const estimatedTokens = estimateComposerTokens(text);

  // 有上下文预算时按真实 token 占用衡量进度，否则退回字符数比。
  const ratio = contextBudget === null ? count / limit : estimatedTokens / contextBudget;
  const tone: ComposerCharacterTone =
    ratio >= 1 ? 'danger' : ratio >= WARNING_RATIO ? 'warning' : 'normal';

  const label =
    contextBudget === null
      ? `${count.toLocaleString()} / ${limit.toLocaleString()} 字符`
      : `约 ${estimatedTokens.toLocaleString()} / ${formatTokenBudget(contextBudget)} tokens`;

  return {
    count,
    limit,
    tone,
    label,
    estimatedTokens,
    contextMaxTokens: contextBudget,
  };
}
