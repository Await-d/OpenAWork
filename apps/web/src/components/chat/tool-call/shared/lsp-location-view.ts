/**
 * LSP 位置类输出的解析（纯函数）。
 *
 * 网关把 `lsp_goto_definition` / `lsp_goto_implementation` / `lsp_find_references`
 * 的结果格式化成每行一条 `path:line:char`（见 `formatLocation`，
 * line 1-based、char 0-based）：多行结果直接 `join('\n')`，无结果时是
 * `No definition found` / `No references found` 这类提示文本。
 *
 * 解析失败（含提示文本）返回 `null`，调用方回退到文本视图。
 */

export interface LspLocationEntry {
  filePath: string;
  /** 1-based 行号。 */
  line: number;
  /** 0-based 列号（LSP 原生口径）。 */
  column?: number;
}

/**
 * `path:line:char` 或 `path:line`。
 *
 * 必须用**非贪婪** `.+?`：贪婪会让 `(.+)` 吃掉 `:12`，把行号误当成列号
 * （实测 `/a.ts:12:4` → path=`/a.ts:12`, line=4）。非贪婪从最早能成立的冒号
 * 开始尝试，Windows 盘符（`C:\…`）会因为后续 `\d+` 不成立而自然跳过。
 */
const LOCATION_PATTERN = /^(.+?):(\d+)(?::(\d+))?$/;

export function parseLspLocations(output: unknown): LspLocationEntry[] | null {
  if (typeof output !== 'string') return null;

  const entries: LspLocationEntry[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const match = LOCATION_PATTERN.exec(line);
    if (!match) continue;
    const filePath = match[1]?.trim() ?? '';
    const lineNumber = Number.parseInt(match[2] ?? '', 10);
    if (filePath.length === 0 || !Number.isFinite(lineNumber) || lineNumber <= 0) continue;
    const column = match[3] !== undefined ? Number.parseInt(match[3], 10) : undefined;
    entries.push({
      filePath,
      line: lineNumber,
      ...(column !== undefined && Number.isFinite(column) ? { column } : {}),
    });
  }

  return entries.length > 0 ? entries : null;
}
