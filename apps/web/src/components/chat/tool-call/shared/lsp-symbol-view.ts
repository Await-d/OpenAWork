/**
 * `lsp_symbols` 输出的解析（纯函数）。
 *
 * 网关有两种行格式（见 `formatDocumentSymbol` / `formatSymbolInfo`）：
 *   - document：`  name (kind 12) - line 42`（前导空格表示层级）
 *   - workspace：`name (kind 12) in Foo - /abs/path.ts:42:8`
 *
 * 解析不出任何符号行时返回 `null`，调用方回退到文本视图。
 */

export interface LspSymbolEntry {
  /** 0 = 顶层；document 模式按两空格缩进折算。 */
  depth: number;
  name: string;
  kindCode: number;
  kindLabel: string;
  /** 1-based 行号。 */
  line?: number;
  /** 0-based 列号。 */
  column?: number;
  /** workspace 模式带路径；document 模式需由调用方用入参 path 补全。 */
  filePath?: string;
  containerName?: string;
}

/** LSP SymbolKind 1–26 的中文名。 */
const SYMBOL_KIND_LABELS: Readonly<Record<number, string>> = {
  1: '文件',
  2: '模块',
  3: '命名空间',
  4: '包',
  5: '类',
  6: '方法',
  7: '属性',
  8: '字段',
  9: '构造函数',
  10: '枚举',
  11: '接口',
  12: '函数',
  13: '变量',
  14: '常量',
  15: '字符串',
  16: '数字',
  17: '布尔',
  18: '数组',
  19: '对象',
  20: '键',
  21: 'null',
  22: '枚举成员',
  23: '结构体',
  24: '事件',
  25: '运算符',
  26: '类型参数',
};

/** document：`<indent>name (kind N) - line L` */
const DOC_SYMBOL_PATTERN = /^(\s*)(.+?) \(kind (\d+)\) - line (\d+)$/;
/** workspace：`name (kind N)[ in container] - path:line:col` */
const WORKSPACE_SYMBOL_PATTERN = /^(.+?) \(kind (\d+)\)(?: in (.+?))? - (.+):(\d+):(\d+)$/;

function kindLabel(code: number): string {
  return SYMBOL_KIND_LABELS[code] ?? `kind ${code}`;
}

function readPositiveInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function parseLspSymbols(output: unknown): LspSymbolEntry[] | null {
  if (typeof output !== 'string') return null;

  const entries: LspSymbolEntry[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    if (line.trim().length === 0) continue;

    const workspaceMatch = WORKSPACE_SYMBOL_PATTERN.exec(line.trim());
    if (workspaceMatch) {
      const kindCode = readPositiveInt(workspaceMatch[2]);
      const lineNumber = readPositiveInt(workspaceMatch[5]);
      const column = readPositiveInt(workspaceMatch[6]);
      if (kindCode !== undefined && lineNumber !== undefined) {
        entries.push({
          depth: 0,
          name: workspaceMatch[1]?.trim() ?? '',
          kindCode,
          kindLabel: kindLabel(kindCode),
          line: lineNumber,
          ...(column !== undefined ? { column } : {}),
          filePath: workspaceMatch[4]?.trim() ?? '',
          ...(workspaceMatch[3] ? { containerName: workspaceMatch[3].trim() } : {}),
        });
        continue;
      }
    }

    const docMatch = DOC_SYMBOL_PATTERN.exec(line);
    if (docMatch) {
      const kindCode = readPositiveInt(docMatch[3]);
      const lineNumber = readPositiveInt(docMatch[4]);
      if (kindCode !== undefined && lineNumber !== undefined) {
        const indent = docMatch[1]?.length ?? 0;
        entries.push({
          depth: Math.floor(indent / 2),
          name: docMatch[2]?.trim() ?? '',
          kindCode,
          kindLabel: kindLabel(kindCode),
          line: lineNumber,
        });
      }
    }
  }

  return entries.length > 0 ? entries : null;
}
