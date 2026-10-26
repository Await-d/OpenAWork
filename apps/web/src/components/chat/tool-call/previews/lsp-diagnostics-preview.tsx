/* ── lsp_diagnostics（按文件分组的诊断列表） ── */

/**
 * `lsp_diagnostics` 的输出有两种形态：
 *
 * 1. **对象 map**（agent-core 的 `z.record(z.string(), z.array(...))`）：
 *    `{ "src/a.ts": [diagnostic, ...], "src/b.ts": [...] }`；
 * 2. **数组**（部分网关转发路径已拍平）：`[diagnostic, ...]`。
 *
 * 单条诊断兼容 LSP 原生结构（`range.start.line` 0-based）与扁平结构
 * （`line` 1-based），两种都见过。
 */

export type LspSeverity = 'error' | 'hint' | 'info' | 'warning';

export interface LspDiagnosticEntry {
  filePath: string;
  /** 1-based 行号（LSP 原生 0-based 已折算）。 */
  line?: number;
  /** 0-based 列号（LSP 原生口径，展示时原样给出）。 */
  column?: number;
  severity: LspSeverity;
  message: string;
  source?: string;
}

/** 每个文件最多渲染的诊断条数（超出给「还有 N 条」）。 */
const MAX_ROWS_PER_FILE = 30;

const SEVERITY_LABELS: Readonly<Record<LspSeverity, string>> = {
  error: '错误',
  warning: '警告',
  info: '信息',
  hint: '提示',
};

const SEVERITY_COLORS: Readonly<Record<LspSeverity, string>> = {
  error: 'var(--danger)',
  warning: 'var(--contrast, var(--accent))',
  info: 'var(--accent)',
  hint: 'var(--fg-muted)',
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeSeverity(value: unknown): LspSeverity {
  if (typeof value === 'number') {
    if (value === 1) return 'error';
    if (value === 2) return 'warning';
    if (value === 3) return 'info';
    return 'hint';
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'error') return 'error';
    if (normalized === 'warning' || normalized === 'warn') return 'warning';
    if (normalized === 'info' || normalized === 'information') return 'info';
    if (normalized === 'hint') return 'hint';
  }
  // LSP 的 severity 缺省按 Error 处理（宁可高亮，不要漏报）。
  return 'error';
}

/** 行 / 列：优先 LSP 的 `range.start`，其次扁平 `line` / `column`。 */
function readPosition(record: Record<string, unknown>): { line?: number; column?: number } {
  const range = asRecord(record['range']);
  const start = range ? asRecord(range['start']) : null;
  const rangeLine = start ? readNumber(start, 'line') : undefined;
  const rangeColumn = start ? readNumber(start, 'character') : undefined;
  if (rangeLine !== undefined) {
    return {
      line: rangeLine + 1,
      ...(rangeColumn !== undefined ? { column: rangeColumn } : {}),
    };
  }

  const line = readNumber(record, 'line');
  const column = readNumber(record, 'column') ?? readNumber(record, 'character');
  return {
    ...(line !== undefined ? { line } : {}),
    ...(column !== undefined ? { column } : {}),
  };
}

function parseDiagnostic(value: unknown, filePath: string): LspDiagnosticEntry | null {
  const record = asRecord(value);
  if (!record) return null;
  const message = typeof record['message'] === 'string' ? record['message'].trim() : '';
  if (message.length === 0) return null;
  const position = readPosition(record);
  const source = typeof record['source'] === 'string' ? record['source'].trim() : '';

  return {
    filePath,
    ...position,
    severity: normalizeSeverity(record['severity']),
    message,
    ...(source.length > 0 ? { source } : {}),
  };
}

function parseDiagnosticArray(value: unknown, filePath: string): LspDiagnosticEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: LspDiagnosticEntry[] = [];
  for (const item of value) {
    const entry = parseDiagnostic(item, filePath);
    if (entry) entries.push(entry);
  }
  return entries;
}

/**
 * 解析诊断输出。返回 `null` 表示「不是诊断结构」，调用方回退到通用渲染。
 * 返回空数组表示「确实是诊断，但没有问题」。
 */
export function extractLspDiagnostics(output: unknown): LspDiagnosticEntry[] | null {
  if (Array.isArray(output)) {
    return parseDiagnosticArray(output, '');
  }

  const record = asRecord(output);
  if (!record) return null;

  // 空对象：该工具名下就是「没有诊断」（LSP 的 map 形态按文件聚合，无问题时是 `{}`）。
  if (Object.keys(record).length === 0) return [];

  const entries: LspDiagnosticEntry[] = [];
  let recognized = false;
  for (const [filePath, value] of Object.entries(record)) {
    if (!Array.isArray(value)) continue;
    recognized = true;
    entries.push(...parseDiagnosticArray(value, filePath));
  }

  return recognized ? entries : null;
}

/**
 * 行内位置只给 `行:列`。
 *
 * 文件路径已经在分组头（每行重复一遍完整路径会让 375px 视口直接横向溢出，
 * 且同组内所有行路径相同，属于纯冗余）。
 */
function formatLocation(entry: LspDiagnosticEntry): string {
  if (entry.line === undefined) return '';
  return entry.column !== undefined ? `${entry.line}:${entry.column}` : String(entry.line);
}

function groupByFile(
  entries: readonly LspDiagnosticEntry[],
): Array<[string, LspDiagnosticEntry[]]> {
  const groups = new Map<string, LspDiagnosticEntry[]>();
  for (const entry of entries) {
    const key = entry.filePath;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(entry);
    } else {
      groups.set(key, [entry]);
    }
  }
  return Array.from(groups.entries());
}

export function LspDiagnosticsPreview({ entries }: { entries: readonly LspDiagnosticEntry[] }) {
  if (entries.length === 0) {
    return <div className="tool-call-inline-empty">（没有诊断信息）</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {groupByFile(entries).map(([filePath, items]) => {
        const visible = items.slice(0, MAX_ROWS_PER_FILE);
        return (
          <section
            key={filePath || '(unknown)'}
            style={{ display: 'flex', flexDirection: 'column', gap: 3 }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
              <span
                title={filePath}
                style={{
                  minWidth: 0,
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--fg-default)',
                  fontFamily:
                    'ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas, Liberation Mono, monospace',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {filePath.length > 0 ? filePath : '诊断'}
              </span>
              {/* 问题数是分组头的关键信息，不能被长路径一起裁掉。 */}
              <span style={{ flexShrink: 0, fontSize: 10, color: 'var(--fg-muted)' }}>
                · {items.length} 个问题
              </span>
            </div>
            <ul
              style={{
                margin: 0,
                padding: 0,
                listStyle: 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}
            >
              {visible.map((entry, index) => (
                <li
                  key={`${entry.line ?? 0}:${entry.column ?? 0}:${index}`}
                  data-lsp-severity={entry.severity}
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 8,
                    minWidth: 0,
                    fontSize: 11,
                    lineHeight: 1.55,
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      minWidth: 28,
                      fontWeight: 600,
                      color: SEVERITY_COLORS[entry.severity],
                    }}
                  >
                    {SEVERITY_LABELS[entry.severity]}
                  </span>
                  <span
                    style={{
                      flexShrink: 0,
                      color: 'var(--fg-muted)',
                      fontFamily:
                        'ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas, Liberation Mono, monospace',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {formatLocation(entry)}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
                    {entry.message}
                  </span>
                  {entry.source && (
                    <span style={{ flexShrink: 0, fontSize: 10, color: 'var(--fg-subtle)' }}>
                      {entry.source}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {items.length > visible.length && (
              <div style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
                还有 {items.length - visible.length} 条未展示…
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
