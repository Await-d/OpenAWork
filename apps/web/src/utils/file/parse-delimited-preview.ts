/**
 * 分隔符分隔文本（CSV / TSV）的表格化解析。
 *
 * 定位是「快速核对字段与内容分布」，不是完整的 RFC 4180 实现：
 * 不处理引号内换行 / 转义引号（`"a,b"` 会被切成两列）。真要精确解析
 * 应交给 SheetJS —— `XlsxPreview` 已经在读 xlsx 时用它。
 *
 * 行为与产物侧原有的 `parseCsvPreview` 保持一致（去空行、trim 单元格、
 * 只取前 N 行），迁移到此处是为了让工作区文件预览与产物预览共用一份实现。
 */

export interface DelimitedPreview {
  headers: string[];
  rows: string[][];
  /** 因超出渲染上限而被丢弃的数据行数（0 表示全文都在预览内）。 */
  truncatedRows: number;
  /** 实际参与解析的行数（表头 + 数据行）。 */
  parsedLines: number;
}

export const DEFAULT_DELIMITED_PREVIEW_ROWS = 200;

export function parseDelimitedPreview(
  content: string,
  delimiter: string,
  maxRows: number = DEFAULT_DELIMITED_PREVIEW_ROWS,
): DelimitedPreview {
  const allLines = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  // 表头 + 数据行共 maxRows 行，超出部分只计数不渲染。
  const lines = allLines.slice(0, maxRows);
  const firstRow = lines[0];
  if (firstRow === undefined) {
    return { headers: [], rows: [], truncatedRows: allLines.length, parsedLines: 0 };
  }

  const headers = firstRow.split(delimiter).map((cell) => cell.trim());
  return {
    headers,
    rows: lines.slice(1).map((line) => line.split(delimiter).map((cell) => cell.trim())),
    truncatedRows: Math.max(0, allLines.length - lines.length),
    parsedLines: lines.length,
  };
}
