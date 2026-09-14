/**
 * 从 Markdown 表格对应的 hast 节点里抽出纯文本行列数据，
 * 用于「复制表格 / 下载 CSV」等导出动作。
 *
 * 不依赖 react-markdown 的渲染结果，也不引入额外依赖：
 * 表格结构本身很规整（table > thead/tbody > tr > th/td），
 * 这里做一次保守的结构化遍历即可。
 */

export interface ExtractedTable {
  /** 表头单元格（无表头时为空数组）。 */
  header: string[];
  /** 数据行，已按列数补齐。 */
  rows: string[][];
  /** 表格总列数。 */
  columnCount: number;
}

interface HastLikeNode {
  type?: unknown;
  tagName?: unknown;
  value?: unknown;
  children?: unknown;
}

function asHastNode(value: unknown): HastLikeNode | null {
  return typeof value === 'object' && value !== null ? (value as HastLikeNode) : null;
}

function asHastChildren(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * 提取节点内的纯文本。`<br>`（模型输出里很常见）还原为换行，
 * 保证多行单元格在导出的 CSV 里不丢结构。
 */
function extractText(node: unknown): string {
  if (typeof node === 'string') {
    return node;
  }

  if (typeof node === 'number') {
    return String(node);
  }

  const hastNode = asHastNode(node);
  if (!hastNode) {
    return '';
  }

  if (hastNode.type === 'text') {
    return typeof hastNode.value === 'string' ? normalizeRawBreaks(hastNode.value) : '';
  }

  if (hastNode.tagName === 'br') {
    return '\n';
  }

  return asHastChildren(hastNode.children).map(extractText).join('');
}

const RAW_BREAK_TAG = /<br\s*\/?>/giu;

/**
 * 未启用 `rehype-raw` 时，原始 `<br>` 会以文本形式进入 hast，
 * 因此需要在这一层把字面量 `<br>` 也还原成换行。
 */
function normalizeRawBreaks(text: string): string {
  return text.replace(RAW_BREAK_TAG, '\n');
}

function getRowsFromSection(section: HastLikeNode): HastLikeNode[] {
  if (section.tagName === 'tr') {
    return [section];
  }

  return asHastChildren(section.children)
    .map(asHastNode)
    .filter((child): child is HastLikeNode => child !== null && child.tagName === 'tr');
}

function readCells(row: HastLikeNode): { cells: string[]; hasHeaderCell: boolean } {
  const cellNodes = asHastChildren(row.children)
    .map(asHastNode)
    .filter(
      (child): child is HastLikeNode =>
        child !== null && (child.tagName === 'th' || child.tagName === 'td'),
    );

  return {
    cells: cellNodes.map((cell) => extractText(cell).trim()),
    hasHeaderCell: cellNodes.some((cell) => cell.tagName === 'th'),
  };
}

/** 解析表格节点；结构不符合预期时返回 `null`。 */
export function extractTableData(node: unknown): ExtractedTable | null {
  const tableNode = asHastNode(node);
  if (!tableNode || tableNode.tagName !== 'table') {
    return null;
  }

  const rowNodes: HastLikeNode[] = [];
  for (const child of asHastChildren(tableNode.children).map(asHastNode)) {
    if (!child) {
      continue;
    }

    if (child.tagName === 'thead' || child.tagName === 'tbody' || child.tagName === 'tfoot') {
      rowNodes.push(...getRowsFromSection(child));
      continue;
    }

    if (child.tagName === 'tr') {
      rowNodes.push(child);
    }
  }

  if (rowNodes.length === 0) {
    return null;
  }

  const parsedRows = rowNodes.map(readCells);
  const firstRow = parsedRows[0];
  const header = firstRow?.hasHeaderCell ? (firstRow.cells ?? []) : [];
  const bodyRows = (header.length > 0 ? parsedRows.slice(1) : parsedRows).map((row) => row.cells);

  const columnCount = Math.max(header.length, ...bodyRows.map((row) => row.length), 0);

  return {
    header: padRow(header, columnCount),
    rows: bodyRows.map((row) => padRow(row, columnCount)),
    columnCount,
  };
}

function padRow(row: string[], columnCount: number): string[] {
  const padded = row.slice(0, columnCount);
  while (padded.length < columnCount) {
    padded.push('');
  }

  return padded;
}

/** 按分隔符拼接为可粘贴文本；换行与分隔符会被就地压平。 */
export function toDelimitedText(rows: string[][], delimiter: '\t' | ',' = '\t'): string {
  const flatten = (value: string): string =>
    value.replace(/\r\n?/gu, '\n').replace(/\t/gu, ' ').replace(/\n/gu, ' ').trim();

  return rows.map((row) => row.map(flatten).join(delimiter)).join('\n');
}

/** 生成 RFC 4180 风格 CSV（含表头）。 */
export function toCsv(table: ExtractedTable): string {
  const lines: string[][] = [];

  if (table.header.length > 0) {
    lines.push(table.header);
  }
  lines.push(...table.rows);

  return lines.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
}

function escapeCsvCell(value: string): string {
  const normalized = value.replace(/\r\n?/gu, '\n');
  if (!/[",\n]/u.test(normalized)) {
    return normalized;
  }

  return `"${normalized.replace(/"/gu, '""')}"`;
}
