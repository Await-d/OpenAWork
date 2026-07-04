import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { CodegraphIndexer } from '../../codegraph/indexer.js';
import { openCodegraphStore } from '../../codegraph/store.js';
import type { CodegraphLspManager, LspDocumentSymbol } from '../../codegraph/contracts.js';

const tempDirs: string[] = [];

async function createWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'openawork-codegraph-indexer-'));
  tempDirs.push(dir);
  await mkdir(join(dir, 'src'), { recursive: true });
  await mkdir(join(dir, 'node_modules/pkg'), { recursive: true });
  await writeFile(
    join(dir, 'src/helper.ts'),
    [
      'export interface HelperOptions {',
      '  readonly enabled: boolean;',
      '}',
      'export function helper(): string {',
      "  return 'ok';",
      '}',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    join(dir, 'src/main.ts'),
    [
      "import { helper } from './helper.js';",
      'export class Runner {',
      '  run(): string {',
      '    return helper();',
      '  }',
      '}',
    ].join('\n'),
    'utf8',
  );
  await writeFile(join(dir, 'node_modules/pkg/ignored.ts'), 'export const ignored = true;', 'utf8');
  return dir;
}

afterEach(async () => {
  const dirs = tempDirs.splice(0);
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

class FakeLspManager implements CodegraphLspManager {
  readonly filesTouched: string[] = [];

  async documentSymbols(input: { readonly file: string }): Promise<readonly LspDocumentSymbol[]> {
    this.filesTouched.push(input.file);
    if (input.file.endsWith('helper.ts')) {
      return [symbol('HelperOptions', 11, 0, 0), symbol('helper', 12, 3, 0)];
    }
    if (input.file.endsWith('main.ts')) {
      return [
        {
          ...symbol('Runner', 5, 1, 0),
          children: [symbol('run', 6, 2, 2)],
        },
      ];
    }
    return [];
  }
}

class ThrowingLspManager implements CodegraphLspManager {
  async documentSymbols(): Promise<readonly LspDocumentSymbol[]> {
    throw new Error('lsp unavailable');
  }
}

function symbol(name: string, kind: number, startLine: number, endLine: number): LspDocumentSymbol {
  return {
    name,
    kind,
    range: {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 1 },
    },
    selectionRange: {
      start: { line: startLine, character: 7 },
      end: { line: startLine, character: 7 + name.length },
    },
  };
}

describe('CodegraphIndexer', () => {
  it('indexes TS symbols, import edges, ignored directories, and repeated runs without duplicates', async () => {
    // Given
    const workspaceRoot = await createWorkspace();
    const store = openCodegraphStore({
      databasePath: join(workspaceRoot, '.cache/codegraph.sqlite'),
    });
    const lspManager = new FakeLspManager();

    try {
      store.initialize();
      const indexer = new CodegraphIndexer({ store, lspManager, limits: { maxFiles: 20 } });

      // When
      const firstRun = await indexer.indexWorkspace({ workspaceRoot });
      const secondRun = await indexer.indexWorkspace({ workspaceRoot });

      // Then
      expect(firstRun.status).toBe('indexed');
      expect(secondRun.status).toBe('indexed');
      expect(
        store
          .listFiles(workspaceRoot)
          .map((file) => file.relativePath)
          .sort(),
      ).toEqual(['src/helper.ts', 'src/main.ts']);
      expect(
        store.searchSymbols({ workspaceRoot, query: '', maxResults: 20 }).map((row) => row.name),
      ).toEqual(['HelperOptions', 'helper', 'Runner', 'run']);
      expect(store.listImportEdges(workspaceRoot)).toMatchObject([
        {
          fromRelativePath: 'src/main.ts',
          toRelativePath: 'src/helper.ts',
          label: './helper.js',
        },
      ]);
      expect(lspManager.filesTouched.some((file) => file.includes('node_modules'))).toBe(false);
    } finally {
      store.close();
    }
  });

  it('records degraded metadata when LSP symbols fail instead of aborting the index run', async () => {
    // Given
    const workspaceRoot = await createWorkspace();
    const store = openCodegraphStore({
      databasePath: join(workspaceRoot, '.cache/codegraph.sqlite'),
    });

    try {
      store.initialize();
      const indexer = new CodegraphIndexer({
        store,
        lspManager: new ThrowingLspManager(),
        limits: { maxFiles: 20 },
      });

      // When
      const result = await indexer.indexWorkspace({ workspaceRoot });

      // Then
      expect(result.status).toBe('degraded');
      expect(result.degradedReason).toContain('lsp unavailable');
      expect(store.listFiles(workspaceRoot).map((file) => file.status)).toEqual([
        'metadata-only',
        'metadata-only',
      ]);
    } finally {
      store.close();
    }
  });
});
