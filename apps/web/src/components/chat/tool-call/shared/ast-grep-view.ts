/**
 * `ast_grep_search` / `ast_grep_replace` 的文本结果解析（纯函数）。
 *
 * 网关格式（`formatAstGrepSearchResults` / `formatAstGrepReplaceResults`）：
 *
 *   找到 3 处匹配（上下文=2）：
 *
 *   src/a.ts:12:5
 *   匹配到的代码片段（可能多行）
 *
 *   src/b.ts:40:1
 *   ...
 *
 * 片段内部可能自带空行，所以**不按空行分段**：逐行扫描，遇到
 * `path:line:column` 行就开启下一条，其余行归入当前片段。
 */

export interface AstGrepMatch {
  filePath: string;
  /** 1-based 行号。 */
  line: number;
  /** 1-based 列号（网关已 +1）。 */
  column: number;
  /** 匹配片段（保留原始缩进与换行）。 */
  snippet: string;
}

/** `path:line:column`（路径可含冒号，用非贪婪 + 锚定行尾）。 */
const LOCATION_LINE = /^(.+?):(\d+):(\d+)$/;

const NO_MATCH_PREFIXES = ['未找到匹配', '试运行：无可应用的改动', '无任何替换被应用'];

export function parseAstGrepMatches(output: unknown): AstGrepMatch[] | null {
  if (typeof output !== 'string') return null;
  const trimmed = output.trim();
  if (trimmed.length === 0) return null;
  if (NO_MATCH_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) return [];

  const matches: AstGrepMatch[] = [];
  let current: AstGrepMatch | null = null;

  for (const rawLine of trimmed.split(/\r?\n/)) {
    const location = LOCATION_LINE.exec(rawLine.trim());
    if (location) {
      if (current) matches.push(current);
      const filePath = location[1]?.trim() ?? '';
      const line = Number.parseInt(location[2] ?? '', 10);
      const column = Number.parseInt(location[3] ?? '', 10);
      if (filePath.length > 0 && Number.isFinite(line)) {
        current = {
          filePath,
          line,
          column: Number.isFinite(column) ? column : 0,
          snippet: '',
        };
      } else {
        current = null;
      }
      continue;
    }

    if (current) {
      current.snippet = current.snippet.length > 0 ? `${current.snippet}\n${rawLine}` : rawLine;
    }
  }

  if (current) matches.push(current);
  if (matches.length === 0) return null;

  // 片段尾部的空行没有信息量，去掉但不影响内部缩进。
  return matches.map((match) => ({ ...match, snippet: match.snippet.replace(/\s+$/, '') }));
}
