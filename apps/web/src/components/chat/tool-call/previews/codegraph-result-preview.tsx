/**
 * `codegraph_*` tools return one of several structured result objects
 * (`search`/`node`/`callers`/`impact`/`status`/`index` — see the gateway's
 * `codegraph/query-service.ts`). They share a symbol/edge shape that reads far
 * better as a list than as a key/value dump, so we normalise them here.
 */
export interface CodegraphSymbol {
  kind: string;
  name: string;
  relativePath: string;
  startLine?: number;
}

export interface CodegraphEdge {
  from?: string;
  kind: string;
  label?: string;
  to?: string;
}

export interface CodegraphView {
  degradedReason?: string;
  edges?: CodegraphEdge[];
  kind: 'callers' | 'impact' | 'index' | 'node' | 'search' | 'status';
  status?: Array<{ label: string; value: string }>;
  symbols?: CodegraphSymbol[];
  truncated?: boolean;
  workspaceRoot?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function toSymbol(value: unknown): CodegraphSymbol | null {
  const record = asRecord(value);
  if (!record) return null;
  const name = record['name'];
  if (typeof name !== 'string' || name.length === 0) return null;
  const range = asRecord(record['range']);
  const startLine = typeof range?.['startLine'] === 'number' ? range['startLine'] : undefined;
  return {
    kind: typeof record['kind'] === 'string' ? record['kind'] : 'symbol',
    name,
    relativePath:
      typeof record['relativePath'] === 'string'
        ? record['relativePath']
        : typeof record['filePath'] === 'string'
          ? record['filePath']
          : '',
    ...(startLine !== undefined ? { startLine } : {}),
  };
}

function symbolName(value: unknown): string | undefined {
  const record = asRecord(value);
  const name = record?.['name'];
  return typeof name === 'string' ? name : undefined;
}

function toEdge(value: unknown): CodegraphEdge | null {
  const record = asRecord(value);
  if (!record) return null;
  const kind = typeof record['kind'] === 'string' ? record['kind'] : 'edge';
  const from = symbolName(record['from']);
  const to = symbolName(record['to']);
  const label = typeof record['label'] === 'string' ? record['label'] : undefined;
  return {
    kind,
    ...(label ? { label } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
}

function collect<T>(value: unknown, convert: (item: unknown) => T | null): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: T[] = [];
  for (const item of value) {
    const converted = convert(item);
    if (converted) out.push(converted);
  }
  return out;
}

function scalar(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function buildStatusStats(
  record: Record<string, unknown>,
): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  const push = (label: string, key: string) => {
    const value = scalar(record[key]);
    if (value !== undefined) rows.push({ label, value });
  };
  push('文件数', 'fileCount');
  push('schema 版本', 'schemaVersion');
  push('已扫描', 'filesScanned');
  push('已索引', 'filesIndexed');
  push('已索引符号', 'symbolsIndexed');
  return rows;
}

export function extractCodegraphResult(output: unknown): CodegraphView | null {
  const record = asRecord(output);
  if (!record) return null;
  const workspaceRoot =
    typeof record['workspaceRoot'] === 'string' ? record['workspaceRoot'] : undefined;
  const degradedReason =
    typeof record['degradedReason'] === 'string' ? record['degradedReason'] : undefined;
  const shared = {
    ...(degradedReason ? { degradedReason } : {}),
    ...(workspaceRoot ? { workspaceRoot } : {}),
  };

  const results = collect(record['results'], toSymbol);
  if (results) {
    return { kind: 'search', symbols: results, ...shared };
  }

  const callers = collect(record['callers'], toEdge);
  if (callers) {
    return { kind: 'callers', edges: callers, ...shared };
  }

  const nodes = collect(record['nodes'], toSymbol);
  if (nodes && Array.isArray(record['edges'])) {
    return {
      kind: 'impact',
      symbols: nodes,
      edges: collect(record['edges'], toEdge) ?? [],
      truncated: record['truncated'] === true,
      ...shared,
    };
  }

  const symbols = collect(record['symbols'], toSymbol);
  const relationships = asRecord(record['relationships']);
  if (symbols && relationships) {
    const edges = [
      ...(collect(relationships['incoming'], toEdge) ?? []),
      ...(collect(relationships['outgoing'], toEdge) ?? []),
    ];
    return { kind: 'node', symbols, edges, ...shared };
  }

  if ('filesIndexed' in record || 'filesScanned' in record) {
    return { kind: 'index', status: buildStatusStats(record), ...shared };
  }

  if ('fileCount' in record || 'schemaVersion' in record) {
    return { kind: 'status', status: buildStatusStats(record), ...shared };
  }

  return null;
}

function SymbolRow({ symbol }: { symbol: CodegraphSymbol }) {
  return (
    <div className="cg-row">
      <span className="cg-symbol">{symbol.name}</span>
      <span className="cg-kind">{symbol.kind}</span>
      {symbol.relativePath && (
        <span className="cg-path">
          {symbol.relativePath}
          {symbol.startLine !== undefined ? `:${symbol.startLine}` : ''}
        </span>
      )}
    </div>
  );
}

function EdgeRow({ edge }: { edge: CodegraphEdge }) {
  return (
    <div className="cg-row">
      <span className="cg-kind">{edge.label ?? edge.kind}</span>
      {edge.from && <span className="cg-symbol">{edge.from}</span>}
      {edge.to && <span className="cg-symbol">→ {edge.to}</span>}
    </div>
  );
}

export function CodegraphResultPreview({ view }: { view: CodegraphView }) {
  const hasSymbols = view.symbols && view.symbols.length > 0;
  const hasEdges = view.edges && view.edges.length > 0;
  const empty = !hasSymbols && !hasEdges && !(view.status && view.status.length > 0);

  return (
    <div className="cg-result">
      {view.workspaceRoot && <div className="cg-root">{view.workspaceRoot}</div>}
      {view.degradedReason && <div className="cg-degraded">{view.degradedReason}</div>}
      {empty && <div className="param-list-empty">（无结果）</div>}
      {hasSymbols && (
        <div className="cg-list">
          {view.symbols?.map((symbol, index) => (
            <SymbolRow key={`${symbol.name}:${symbol.relativePath}:${index}`} symbol={symbol} />
          ))}
        </div>
      )}
      {hasEdges && (
        <div className="cg-list">
          {view.edges?.map((edge, index) => (
            <EdgeRow
              key={`${edge.kind}:${edge.from ?? ''}:${edge.to ?? ''}:${index}`}
              edge={edge}
            />
          ))}
        </div>
      )}
      {view.status && view.status.length > 0 && (
        <div className="cg-status">
          {view.status.map((row) => (
            <div className="cg-status-row" key={row.label}>
              <span className="cg-status-label">{row.label}</span>
              <span className="cg-status-value">{row.value}</span>
            </div>
          ))}
        </div>
      )}
      {view.truncated && <div className="cg-truncated">结果已截断</div>}
    </div>
  );
}
