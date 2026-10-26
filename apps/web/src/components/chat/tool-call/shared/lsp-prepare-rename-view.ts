/**
 * `lsp_prepare_rename` 文本输出的解析（纯函数）。
 *
 * 网关 `formatPrepareRenameResult` 的三种文案：
 * - `Rename available at 12:5-12:9`（可重命名 + 目标范围，1-based 行）
 * - `Rename supported (using default behavior)`
 * - `Cannot rename at this position`
 */

export type LspPrepareRenameView = { kind: 'available'; range?: string } | { kind: 'unavailable' };

const AVAILABLE_WITH_RANGE = /^Rename available at (.+)$/i;
const AVAILABLE = /^Rename supported/i;
const UNAVAILABLE = /^Cannot rename at this position\.?$/i;

export function parseLspPrepareRename(output: unknown): LspPrepareRenameView | null {
  if (typeof output !== 'string') return null;
  const trimmed = output.trim();
  if (trimmed.length === 0) return null;

  const withRange = AVAILABLE_WITH_RANGE.exec(trimmed);
  if (withRange) {
    const range = withRange[1]?.trim() ?? '';
    return { kind: 'available', ...(range.length > 0 ? { range } : {}) };
  }
  if (AVAILABLE.test(trimmed)) return { kind: 'available' };
  if (UNAVAILABLE.test(trimmed)) return { kind: 'unavailable' };
  return null;
}
