import { resolve } from 'node:path';
import type {
  CodegraphEdgeRecord,
  CodegraphFileRecord,
  CodegraphFreshness,
  CodegraphStartupStatusRecord,
  CodegraphSymbolRecord,
} from './contracts.js';
import type { CodegraphStore } from './store.js';

const DEFAULT_MAX_RESULTS = 20;
const DEFAULT_MAX_EDGES = 40;
const DEFAULT_MAX_DEPTH = 2;

export type CodegraphQueryServiceInput = {
  readonly store: CodegraphStore;
};

export type CodegraphStatusResult = {
  readonly workspaceRoot: string;
  readonly schemaVersion: number;
  readonly freshness: CodegraphFreshness;
  readonly startup:
    | CodegraphStartupStatusRecord
    | { readonly status: 'degraded'; readonly degradedReason: string };
  readonly fileCount: number;
  readonly latestRun?: {
    readonly status: string;
    readonly finishedAtMs: number;
    readonly filesScanned: number;
    readonly filesIndexed: number;
    readonly symbolsIndexed: number;
    readonly degradedReason?: string;
  };
};

export type CodegraphSearchResult = {
  readonly workspaceRoot: string;
  readonly freshness: CodegraphFreshness;
  readonly results: readonly CodegraphSymbolSummary[];
  readonly degradedReason?: string;
};

export type CodegraphNodeResult = {
  readonly workspaceRoot: string;
  readonly freshness: CodegraphFreshness;
  readonly symbols: readonly CodegraphSymbolSummary[];
  readonly relationships: {
    readonly incoming: readonly CodegraphEdgeSummary[];
    readonly outgoing: readonly CodegraphEdgeSummary[];
  };
  readonly degradedReason?: string;
};

export type CodegraphCallersResult = {
  readonly workspaceRoot: string;
  readonly freshness: CodegraphFreshness;
  readonly callers: readonly CodegraphEdgeSummary[];
  readonly degradedReason?: string;
};

export type CodegraphImpactResult = {
  readonly workspaceRoot: string;
  readonly freshness: CodegraphFreshness;
  readonly nodes: readonly CodegraphSymbolSummary[];
  readonly edges: readonly CodegraphEdgeSummary[];
  readonly truncated: boolean;
  readonly degradedReason?: string;
};

export type CodegraphSymbolSummary = {
  readonly id: number;
  readonly name: string;
  readonly kind: string;
  readonly filePath: string;
  readonly relativePath: string;
  readonly range: {
    readonly startLine: number;
    readonly startCharacter: number;
    readonly endLine: number;
    readonly endCharacter: number;
  };
};

export type CodegraphEdgeSummary = {
  readonly id: number;
  readonly kind: string;
  readonly label?: string;
  readonly from?: CodegraphSymbolSummary;
  readonly to?: CodegraphSymbolSummary;
};

export class CodegraphQueryService {
  private readonly store: CodegraphStore;

  constructor(input: CodegraphQueryServiceInput) {
    this.store = input.store;
  }

  status(workspaceRoot: string): CodegraphStatusResult {
    const root = resolve(workspaceRoot);
    const freshness = this.store.getFreshness(root);
    const latestRun = this.store.getLatestIndexRun(root);
    const startup = this.store.readStartupStatus() ?? {
      status: 'degraded',
      degradedReason: 'codegraph startup preflight has not run',
    };
    return {
      workspaceRoot: root,
      schemaVersion: this.store.getSchemaVersion(),
      freshness,
      startup,
      fileCount: this.store.listFiles(root).length,
      latestRun: latestRun
        ? {
            status: latestRun.status,
            finishedAtMs: latestRun.finishedAtMs,
            filesScanned: latestRun.filesScanned,
            filesIndexed: latestRun.filesIndexed,
            symbolsIndexed: latestRun.symbolsIndexed,
            degradedReason: latestRun.degradedReason,
          }
        : undefined,
    };
  }

  search(input: {
    readonly workspaceRoot: string;
    readonly query: string;
    readonly maxResults?: number;
  }): CodegraphSearchResult {
    const workspaceRoot = resolve(input.workspaceRoot);
    const freshness = this.store.getFreshness(workspaceRoot);
    const symbols = this.store.searchSymbols({
      workspaceRoot,
      query: input.query,
      maxResults: clampPositive(input.maxResults, DEFAULT_MAX_RESULTS, 100),
    });
    return {
      workspaceRoot,
      freshness,
      results: symbols.map((symbol) => this.summarizeSymbol(symbol)).filter(isDefined),
      degradedReason: freshness.degradedReason,
    };
  }

  node(input: {
    readonly workspaceRoot: string;
    readonly symbolName: string;
    readonly maxEdges?: number;
  }): CodegraphNodeResult {
    const workspaceRoot = resolve(input.workspaceRoot);
    const freshness = this.store.getFreshness(workspaceRoot);
    const maxEdges = clampPositive(input.maxEdges, DEFAULT_MAX_EDGES, 100);
    const symbols = this.store.searchSymbols({
      workspaceRoot,
      query: input.symbolName,
      maxResults: 10,
    });
    const exactSymbols = symbols.filter((symbol) => symbol.name === input.symbolName);
    const selected = exactSymbols.length > 0 ? exactSymbols : symbols.slice(0, 1);
    const edgeBudget = Math.max(1, Math.floor(maxEdges / Math.max(1, selected.length)));
    const incoming = selected.flatMap((symbol) =>
      this.store
        .listIncomingSymbolEdges(symbol.id, edgeBudget)
        .map((edge) => this.summarizeEdge(edge)),
    );
    const outgoing = selected.flatMap((symbol) =>
      this.store
        .listOutgoingSymbolEdges(symbol.id, edgeBudget)
        .map((edge) => this.summarizeEdge(edge)),
    );
    return {
      workspaceRoot,
      freshness,
      symbols: selected.map((symbol) => this.summarizeSymbol(symbol)).filter(isDefined),
      relationships: {
        incoming: incoming.filter(isDefined).slice(0, maxEdges),
        outgoing: outgoing.filter(isDefined).slice(0, maxEdges),
      },
      degradedReason: selected.length === 0 ? freshness.degradedReason : undefined,
    };
  }

  callers(input: {
    readonly workspaceRoot: string;
    readonly symbolName: string;
    readonly maxResults?: number;
  }): CodegraphCallersResult {
    const workspaceRoot = resolve(input.workspaceRoot);
    const freshness = this.store.getFreshness(workspaceRoot);
    const symbols = this.store
      .searchSymbols({
        workspaceRoot,
        query: input.symbolName,
        maxResults: 10,
      })
      .filter((symbol) => symbol.name === input.symbolName);
    const maxResults = clampPositive(input.maxResults, DEFAULT_MAX_RESULTS, 100);
    const callers = symbols.flatMap((symbol) =>
      this.store
        .listIncomingSymbolEdges(symbol.id, maxResults)
        .map((edge) => this.summarizeEdge(edge)),
    );
    return {
      workspaceRoot,
      freshness,
      callers: callers.filter(isDefined).slice(0, maxResults),
      degradedReason: symbols.length === 0 ? freshness.degradedReason : undefined,
    };
  }

  impact(input: {
    readonly workspaceRoot: string;
    readonly symbolName: string;
    readonly maxDepth?: number;
    readonly maxResults?: number;
  }): CodegraphImpactResult {
    const workspaceRoot = resolve(input.workspaceRoot);
    const freshness = this.store.getFreshness(workspaceRoot);
    const roots = this.store
      .searchSymbols({
        workspaceRoot,
        query: input.symbolName,
        maxResults: 10,
      })
      .filter((symbol) => symbol.name === input.symbolName);
    const maxDepth = clampPositive(input.maxDepth, DEFAULT_MAX_DEPTH, 5);
    const maxResults = clampPositive(input.maxResults, DEFAULT_MAX_RESULTS, 100);
    const visited = new Set<number>();
    const queue = roots.map((symbol) => ({ symbol, depth: 0 }));
    const nodes: CodegraphSymbolSummary[] = [];
    const edges: CodegraphEdgeSummary[] = [];
    let truncated = false;

    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) {
        break;
      }
      if (visited.has(item.symbol.id)) {
        continue;
      }
      visited.add(item.symbol.id);
      const summary = this.summarizeSymbol(item.symbol);
      if (summary) {
        nodes.push(summary);
      }
      if (nodes.length >= maxResults) {
        truncated = queue.length > 0;
        break;
      }
      if (item.depth >= maxDepth) {
        continue;
      }
      const outgoing = this.store.listOutgoingSymbolEdges(item.symbol.id, maxResults);
      for (const edge of outgoing) {
        const edgeSummary = this.summarizeEdge(edge);
        if (edgeSummary) {
          edges.push(edgeSummary);
        }
        const targetId = edge.toSymbolId;
        const target = targetId ? this.store.getSymbolById(targetId) : undefined;
        if (target && !visited.has(target.id)) {
          queue.push({ symbol: target, depth: item.depth + 1 });
        }
        if (edges.length >= maxResults) {
          truncated = true;
          break;
        }
      }
      if (truncated) {
        break;
      }
    }

    return {
      workspaceRoot,
      freshness,
      nodes,
      edges: edges.slice(0, maxResults),
      truncated,
      degradedReason: roots.length === 0 ? freshness.degradedReason : undefined,
    };
  }

  private summarizeEdge(edge: CodegraphEdgeRecord): CodegraphEdgeSummary | undefined {
    const from = edge.fromSymbolId ? this.store.getSymbolById(edge.fromSymbolId) : undefined;
    const to = edge.toSymbolId ? this.store.getSymbolById(edge.toSymbolId) : undefined;
    return {
      id: edge.id,
      kind: edge.kind,
      label: edge.label,
      from: from ? this.summarizeSymbol(from) : undefined,
      to: to ? this.summarizeSymbol(to) : undefined,
    };
  }

  private summarizeSymbol(symbol: CodegraphSymbolRecord): CodegraphSymbolSummary | undefined {
    const file = this.store.getFileById(symbol.fileId);
    if (!file) {
      return undefined;
    }
    return summarizeSymbolWithFile(symbol, file);
  }
}

function summarizeSymbolWithFile(
  symbol: CodegraphSymbolRecord,
  file: CodegraphFileRecord,
): CodegraphSymbolSummary {
  return {
    id: symbol.id,
    name: symbol.name,
    kind: symbol.kind,
    filePath: file.path,
    relativePath: file.relativePath,
    range: {
      startLine: symbol.startLine,
      startCharacter: symbol.startCharacter,
      endLine: symbol.endLine,
      endCharacter: symbol.endCharacter,
    },
  };
}

function clampPositive(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(value), max);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
