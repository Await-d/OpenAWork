/**
 * Pull a short, single-line error summary out of a failed tool call's
 * output for surfacing in the collapsed header. The full payload is
 * still available behind the "expand" chevron — this helper exists so
 * users see *what went wrong* without having to click first.
 *
 * 摘要口径（2026-11 起）：字符串输出不再「取首行 + 截 80 字符」，而是交给
 * `buildToolFailureView` 的**结构化结论**——agentignore 拦截、工作区越界这类
 * 多段文本的首行往往只是半句，真正原因落在截断点之后。命中已知形态时摘要变成
 * 「分类标签 · 一句话结论」（如「写入被拒绝 · agentignore 保护路径」），认不出
 * 形态时仍是首行。
 *
 * Output shapes we accommodate (in priority order):
 *   1. `string` — structured headline (via `buildToolFailureView`), else first non-empty line.
 *   2. `{ error: string }` — the field as-is.
 *   3. `{ error: { message: string, … } }` — nested message.
 *   4. `{ message: string }` — top-level message.
 *   5. `{ stderr: string }` — first non-empty stderr line.
 *   6. `{ exitCode: number }` with non-zero — `exit N` fallback.
 *
 * Returns null when the call is not in error or no useful summary can
 * be extracted, so the caller can omit the banner entirely.
 */

import {
  buildToolFailureView,
  TOOL_FAILURE_CATEGORY_LABEL,
  type ToolFailureView,
} from './tool-failure-view.js';

/**
 * 折叠态上限。80 太窄：中文结论（「写入被拒绝 · agentignore 保护路径」这类）之外
 * 还常带一段路径，80 会在路径中间截断，反而看不出是哪个文件。样式仍是单行省略号，
 * 所以放宽到 120 不会撑破折叠行。
 */
const ERROR_CLAMP_LEN = 120;

export function extractErrorSummary(output: unknown, isError: boolean | undefined): string | null {
  // Only kick in when the call is actually flagged as failed. A call
  // with `isError: false` and no output should never display an
  // error summary, even if a stale object happens to expose `.error`.
  if (!isError) return null;

  if (typeof output === 'string') {
    const view = buildToolFailureView(output, true);
    if (view) return summarizeFailureView(view);
  }

  if (output && typeof output === 'object') {
    const obj = output as Record<string, unknown>;

    const err = obj.error;
    if (typeof err === 'string' && err.trim()) {
      return clamp(err.trim());
    }
    if (err && typeof err === 'object') {
      const nestedMessage = (err as Record<string, unknown>).message;
      if (typeof nestedMessage === 'string' && nestedMessage.trim()) {
        return clamp(nestedMessage.trim());
      }
    }

    if (typeof obj.message === 'string' && obj.message.trim()) {
      return clamp(obj.message.trim());
    }

    if (typeof obj.stderr === 'string') {
      const stderrLine = firstNonEmptyLine(obj.stderr);
      if (stderrLine) return clamp(stderrLine);
    }

    if (typeof obj.exitCode === 'number' && Number.isFinite(obj.exitCode) && obj.exitCode !== 0) {
      return `exit ${obj.exitCode}`;
    }
  }

  // `isError === true` but output didn't expose anything we
  // recognise — surface a generic label so the banner still
  // triggers and users know to drill into the raw output.
  return '执行失败';
}

/**
 * 折叠态文案：结构化视图给「分类 · 结论」，纯文本视图只给结论。
 *
 * 分类标签不能省——「文件或目录不存在」单独出现时读者不知道是读还是写失败。
 */
function summarizeFailureView(view: ToolFailureView): string {
  if (view.kind === 'structured') {
    return `${TOOL_FAILURE_CATEGORY_LABEL[view.category]} · ${view.headline}`;
  }
  if (view.category) return `${TOOL_FAILURE_CATEGORY_LABEL[view.category]} · ${view.headline}`;
  return clamp(view.headline);
}

function firstNonEmptyLine(text: string): string | null {
  if (!text) return null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

function clamp(s: string): string {
  if (s.length <= ERROR_CLAMP_LEN) return s;
  return `${s.slice(0, ERROR_CLAMP_LEN - 1)}…`;
}
