import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { CodegraphIndexer } from '../../codegraph/indexer.js';
import { CodegraphQueryService } from '../../codegraph/query-service.js';
import { openCodegraphStore } from '../../codegraph/store.js';
import type { CodegraphLspManager, LspDocumentSymbol } from '../../codegraph/contracts.js';

const tempDirs: string[] = [];

async function createWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'openawork-codegraph-query-'));
  tempDirs.push(dir);
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(
    join(dir, 'src/a.ts'),
    'export function target(): string { return "a"; }',
    'utf8',
  );
  await writeFile(
    join(dir, 'src/b.ts'),
    'import { target } from "./a.js"; export function caller(): string { return target(); }',
    'utf8',
  );
  return dir;
}

afterEach(async () => {
  const dirs = tempDirs.splice(0);
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

class QueryFakeLspManager implements CodegraphLspManager {
  async documentSymbols(input: { readonly file: string }): Promise<readonly LspDocumentSymbol[]> {
    if (input.file.endsWith('a.ts')) {
      return [symbol('target', 12, 0)];
    }
    return [symbol('caller', 12, 0)];
  }
}

function symbol(name: string, kind: number, line: number): LspDocumentSymbol {
  return {
    name,
    kind,
    range: {
      start: { line, character: 0 },
      end: { line, character: 40 },
    },
    selectionRange: {
      start: { line, character: 16 },
      end: { line, character: 16 + name.length },
    },
  };
}

describe('CodegraphQueryService', () => {
  it('returns bounded search, node, caller, impact, and freshness metadata', async () => {
    // Given
    const workspaceRoot = await createWorkspace();
    const store = openCodegraphStore({
      databasePath: join(workspaceRoot, '.cache/codegraph.sqlite'),
    });

    try {
      store.initialize();
      const indexer = new CodegraphIndexer({ store, lspManager: new QueryFakeLspManager() });
      await indexer.indexWorkspace({ workspaceRoot });
      const caller = store.searchSymbols({ workspaceRoot, query: 'caller', maxResults: 1 })[0];
      const target = store.searchSymbols({ workspaceRoot, query: 'target', maxResults: 1 })[0];
      expect(caller).toBeDefined();
      expect(target).toBeDefined();
      if (!caller || !target) {
        throw new Error('expected indexed caller and target symbols');
      }
      store.recordSymbolEdge({
        workspaceRoot,
        fromSymbolId: caller.id,
        toSymbolId: target.id,
        kind: 'calls',
        label: 'caller invokes target',
      });
      store.recordSymbolEdge({
        workspaceRoot,
        fromSymbolId: caller.id,
        toSymbolId: target.id,
        kind: 'references',
        label: 'caller references target',
      });
      store.markFilesStale({
        workspaceRoot,
        files: [join(workspaceRoot, 'src/a.ts')],
        reason: 'manual-edit',
      });
      const queryService = new CodegraphQueryService({ store });

      // When
      const search = queryService.search({ workspaceRoot, query: 'tar', maxResults: 10 });
      const node = queryService.node({ workspaceRoot, symbolName: 'target', maxEdges: 10 });
      const callers = queryService.callers({ workspaceRoot, symbolName: 'target', maxResults: 10 });
      const impact = queryService.impact({
        workspaceRoot,
        symbolName: 'caller',
        maxDepth: 2,
        maxResults: 10,
      });

      // Then
      expect(search.results.map((result) => result.name)).toEqual(['target']);
      expect(search.freshness.status).toBe('stale');
      expect(node.symbols[0]?.name).toBe('target');
      expect(node.relationships.incoming.map((edge) => edge.kind).sort()).toEqual([
        'calls',
        'references',
      ]);
      expect(callers.callers.map((edge) => edge.kind).sort()).toEqual(['calls', 'references']);
      expect(impact.nodes.map((result) => result.name)).toEqual(['caller', 'target']);
      expect(impact.truncated).toBe(false);
    } finally {
      store.close();
    }
  });

  it('returns deterministic not-indexed and empty query responses', async () => {
    // Given
    const workspaceRoot = await createWorkspace();
    const store = openCodegraphStore({
      databasePath: join(workspaceRoot, '.cache/codegraph.sqlite'),
    });

    try {
      store.initialize();
      const queryService = new CodegraphQueryService({ store });

      // When
      const search = queryService.search({ workspaceRoot, query: 'missing', maxResults: 10 });
      const node = queryService.node({ workspaceRoot, symbolName: 'missing', maxEdges: 10 });

      // Then
      expect(search.freshness.status).toBe('not_indexed');
      expect(search.results).toEqual([]);
      expect(node.symbols).toEqual([]);
      expect(node.degradedReason).toBe('workspace has not been indexed');
    } finally {
      store.close();
    }
  });
});
