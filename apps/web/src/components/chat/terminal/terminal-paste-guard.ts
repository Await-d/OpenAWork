/**
 * 粘贴保护：一次 `onData` 携带的文本过大时（长文本或大量换行），
 * 直接灌进 shell 很容易变成「误粘贴即执行一整段命令」。这里只做**判定**，
 * 弹窗与「不再提示」的持久化交给调用方，保持纯函数便于单测。
 */

/** 单次粘贴超过该字符数需要二次确认。 */
export const PASTE_CONFIRM_CHAR_THRESHOLD = 1000;
/** 单次粘贴包含的换行数达到该值时需要二次确认（多行粘贴风险最高）。 */
export const PASTE_CONFIRM_LINE_THRESHOLD = 5;
/** 确认框里展示的摘要预览上限。 */
export const PASTE_PREVIEW_MAX_CHARS = 80;

export interface PasteGuardSummary {
  /** 文本长度（UTF-16 code unit 计数，与 `String.length` 一致）。 */
  chars: number;
  /** 换行符数量，`\r\n` / `\r` / `\n` 均按 1 个换行计。 */
  lines: number;
  /** 截断后的单行预览，换行显示为 `⏎`。 */
  preview: string;
}

export interface PasteGuardDecision {
  needsConfirm: boolean;
  summary: PasteGuardSummary;
}

const LINE_BREAK_PATTERN = /\r\n|[\r\n]/g;

export function summarizePastedText(data: string): PasteGuardSummary {
  const firstLine = data.slice(0, PASTE_PREVIEW_MAX_CHARS).replace(LINE_BREAK_PATTERN, '⏎');
  return {
    chars: data.length,
    lines: data.match(LINE_BREAK_PATTERN)?.length ?? 0,
    preview: data.length > PASTE_PREVIEW_MAX_CHARS ? `${firstLine}…` : firstLine,
  };
}

/** 阈值可注入，便于单测覆盖边界而不必真的造 1000 字符。 */
export function evaluatePasteGuard(
  data: string,
  thresholds: { chars?: number; lines?: number } = {},
): PasteGuardDecision {
  const summary = summarizePastedText(data);
  const charLimit = thresholds.chars ?? PASTE_CONFIRM_CHAR_THRESHOLD;
  const lineLimit = thresholds.lines ?? PASTE_CONFIRM_LINE_THRESHOLD;
  return {
    needsConfirm: summary.chars > charLimit || summary.lines >= lineLimit,
    summary,
  };
}
