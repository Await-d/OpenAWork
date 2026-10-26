/**
 * `lsp_call_hierarchy` 文本输出的解析（纯函数）。
 *
 * 网关格式（`lspCallHierarchyToolDefinition.execute`）：
 *
 *   Symbol: run (detail) - /repo/src/a.ts:12:4
 *
 *   Incoming calls:
 *     caller - /repo/src/b.ts:8:2
 *     other (detail) - /repo/src/c.ts:30:0
 *
 *   Outgoing calls:
 *     callee - /repo/src/d.ts:1:0
 *
 * 空段直接是 `No incoming calls found` / `No outgoing calls found`；
 * 完全查不到时是 `No call hierarchy found`。
 */

export interface LspCallHierarchyEntry {
  name: string;
  detail?: string;
  filePath: string;
  /** 1-based 行号。 */
  line: number;
  /** 0-based 列号（LSP 原生口径）。 */
  column?: number;
}

export interface LspCallHierarchyView {
  symbol: LspCallHierarchyEntry | null;
  incoming: LspCallHierarchyEntry[];
  outgoing: LspCallHierarchyEntry[];
}

/** `name (detail) - path:line:col`；detail 可缺省。 */
const ENTRY_PATTERN = /^(.+?)(?: \(([^()]*)\))? - (.+):(\d+):(\d+)$/;

function parseEntry(line: string): LspCallHierarchyEntry | null {
  const match = ENTRY_PATTERN.exec(line.trim());
  if (!match) return null;
  const filePath = match[3]?.trim() ?? '';
  const lineNumber = Number.parseInt(match[4] ?? '', 10);
  const column = Number.parseInt(match[5] ?? '', 10);
  if (filePath.length === 0 || !Number.isFinite(lineNumber)) return null;
  return {
    name: match[1]?.trim() ?? '',
    ...(match[2] ? { detail: match[2].trim() } : {}),
    filePath,
    line: lineNumber,
    ...(Number.isFinite(column) ? { column } : {}),
  };
}

export function parseLspCallHierarchy(output: unknown): LspCallHierarchyView | null {
  if (typeof output !== 'string') return null;
  const trimmed = output.trim();
  if (trimmed.length === 0) return null;
  if (/^No call hierarchy found\.?$/i.test(trimmed)) return null;

  const view: LspCallHierarchyView = { symbol: null, incoming: [], outgoing: [] };
  let section: 'symbol' | 'incoming' | 'outgoing' = 'symbol';

  for (const rawLine of trimmed.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    if (line.startsWith('Symbol:')) {
      view.symbol = parseEntry(line.slice('Symbol:'.length));
      section = 'symbol';
      continue;
    }
    if (line.startsWith('Incoming calls:')) {
      section = 'incoming';
      continue;
    }
    if (line.startsWith('Outgoing calls:')) {
      section = 'outgoing';
      continue;
    }
    if (/^No (incoming|outgoing) calls found\.?$/i.test(line)) continue;

    const entry = parseEntry(line);
    if (!entry) continue;
    if (section === 'incoming') view.incoming.push(entry);
    else if (section === 'outgoing') view.outgoing.push(entry);
  }

  if (!view.symbol && view.incoming.length === 0 && view.outgoing.length === 0) return null;
  return view;
}
