import { relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { CodegraphIndexer } from '../codegraph/indexer.js';
import { CodegraphQueryService } from '../codegraph/query-service.js';
import { openCodegraphStore, type CodegraphStore } from '../codegraph/store.js';
import type { CodegraphLspManager, LspDocumentSymbol } from '../codegraph/contracts.js';
import { resolveGatewayCodegraphDatabasePath } from '../infra/storage-paths.js';
import { lspManager } from '../lsp/router.js';
import type { boundedDegradedOutputSchema } from './codegraph-tool-schemas.js';
import {
  codegraphCallersInputSchema,
  codegraphImpactInputSchema,
  codegraphIndexInputSchema,
  codegraphNodeInputSchema,
  codegraphSearchInputSchema,
  codegraphStatusInputSchema,
} from './codegraph-tool-schemas.js';
import {
  buildDegradedOutput,
  resolveActiveWorkspaceRoot,
  resolveCodegraphScopedPath,
} from './codegraph-tool-workspace.js';

const lspPositionSchema = z.object({
  line: z.number().int().min(0),
  character: z.number().int().min(0),
});

const lspRangeSchema = z.object({
  start: lspPositionSchema,
  end: lspPositionSchema,
});

type ParsedLspDocumentSymbol = {
  readonly name: string;
  readonly kind: number;
  readonly detail?: string;
  readonly range: z.infer<typeof lspRangeSchema>;
  readonly selectionRange: z.infer<typeof lspRangeSchema>;
  readonly children?: readonly ParsedLspDocumentSymbol[];
};

const lspDocumentSymbolSchema: z.ZodType<ParsedLspDocumentSymbol> = z.lazy(() =>
  z.object({
    name: z.string(),
    kind: z.number().int(),
    detail: z.string().optional(),
    range: lspRangeSchema,
    selectionRange: lspRangeSchema,
    children: z.array(lspDocumentSymbolSchema).optional(),
  }),
);

const lspDocumentSymbolsSchema = z.array(lspDocumentSymbolSchema);

const codegraphLspManager: CodegraphLspManager = {
  async documentSymbols(input: { readonly file: string }): Promise<readonly LspDocumentSymbol[]> {
    const raw = await lspManager.documentSymbols(input);
    return lspDocumentSymbolsSchema.parse(raw);
  },
};

type CodegraphToolOutput =
  | z.infer<typeof boundedDegradedOutputSchema>
  | ReturnType<CodegraphQueryService['status']>
  | ReturnType<CodegraphQueryService['search']>
  | ReturnType<CodegraphQueryService['node']>
  | ReturnType<CodegraphQueryService['callers']>
  | ReturnType<CodegraphQueryService['impact']>
  | Awaited<ReturnType<CodegraphIndexer['indexWorkspace']>>
  | ReturnType<typeof buildFileNodeResult>;

export async function executeCodegraphTool(input: {
  readonly sessionId: string;
  readonly toolName: string;
  readonly rawInput: Record<string, unknown>;
}): Promise<CodegraphToolOutput> {
  switch (input.toolName) {
    case 'codegraph_status': {
      const parsed = codegraphStatusInputSchema.parse(input.rawInput);
      const workspaceRoot = resolveActiveWorkspaceRoot(input.sessionId, parsed.workspaceRoot);
      return withCodegraphFallback(input.sessionId, workspaceRoot, undefined, (store) =>
        new CodegraphQueryService({ store }).status(workspaceRoot),
      );
    }
    case 'codegraph_index': {
      const parsed = codegraphIndexInputSchema.parse(input.rawInput);
      const workspaceRoot = resolveActiveWorkspaceRoot(input.sessionId, parsed.workspaceRoot);
      if (parsed.path) {
        resolveCodegraphScopedPath(workspaceRoot, parsed.path);
      }
      return withCodegraphFallback(input.sessionId, workspaceRoot, parsed.path, async (store) => {
        const indexer = new CodegraphIndexer({ store, lspManager: codegraphLspManager });
        return indexer.indexWorkspace({ workspaceRoot });
      });
    }
    case 'codegraph_search': {
      const parsed = codegraphSearchInputSchema.parse(input.rawInput);
      const workspaceRoot = resolveActiveWorkspaceRoot(input.sessionId, parsed.workspaceRoot);
      return withCodegraphFallback(input.sessionId, workspaceRoot, undefined, (store) =>
        new CodegraphQueryService({ store }).search({
          workspaceRoot,
          query: parsed.query,
          maxResults: parsed.limit,
        }),
      );
    }
    case 'codegraph_node': {
      const parsed = codegraphNodeInputSchema.parse(input.rawInput);
      const workspaceRoot = resolveActiveWorkspaceRoot(input.sessionId, parsed.workspaceRoot);
      if (parsed.file) {
        resolveCodegraphScopedPath(workspaceRoot, parsed.file);
      }
      return withCodegraphFallback(input.sessionId, workspaceRoot, parsed.file, (store) => {
        const queryService = new CodegraphQueryService({ store });
        if (parsed.symbol) {
          return queryService.node({
            workspaceRoot,
            symbolName: parsed.symbol,
            maxEdges: parsed.limit,
          });
        }
        return buildFileNodeResult(store, workspaceRoot, parsed.file, parsed.limit);
      });
    }
    case 'codegraph_callers': {
      const parsed = codegraphCallersInputSchema.parse(input.rawInput);
      const workspaceRoot = resolveActiveWorkspaceRoot(input.sessionId, parsed.workspaceRoot);
      if (parsed.file) {
        resolveCodegraphScopedPath(workspaceRoot, parsed.file);
      }
      return withCodegraphFallback(input.sessionId, workspaceRoot, parsed.file, (store) =>
        new CodegraphQueryService({ store }).callers({
          workspaceRoot,
          symbolName: parsed.symbol,
          maxResults: parsed.limit,
        }),
      );
    }
    case 'codegraph_impact': {
      const parsed = codegraphImpactInputSchema.parse(input.rawInput);
      const workspaceRoot = resolveActiveWorkspaceRoot(input.sessionId, parsed.workspaceRoot);
      if (parsed.file) {
        resolveCodegraphScopedPath(workspaceRoot, parsed.file);
      }
      return withCodegraphFallback(input.sessionId, workspaceRoot, parsed.file, (store) =>
        new CodegraphQueryService({ store }).impact({
          workspaceRoot,
          symbolName: parsed.symbol,
          maxDepth: parsed.maxDepth,
          maxResults: parsed.maxResults,
        }),
      );
    }
    default:
      throw new Error(`Unsupported codegraph tool: ${input.toolName}`);
  }
}

async function withCodegraphFallback<T>(
  sessionId: string,
  workspaceRoot: string,
  path: string | undefined,
  run: (store: CodegraphStore) => T | Promise<T>,
): Promise<T | z.infer<typeof boundedDegradedOutputSchema>> {
  let store;
  try {
    store = openCodegraphStore({ databasePath: resolveGatewayCodegraphDatabasePath() });
    store.initialize();
    return await run(store);
  } catch (error) {
    if (error instanceof Error) {
      return buildDegradedOutput({
        sessionId,
        workspaceRoot,
        path,
        reason: `codegraph 核心服务执行失败：${error.message}`,
      });
    }
    throw error;
  } finally {
    store?.close();
  }
}

function buildFileNodeResult(
  store: CodegraphStore,
  workspaceRoot: string,
  file: string | undefined,
  limit: number | undefined,
) {
  const resolvedFile = file ? resolve(workspaceRoot, file) : undefined;
  const relativeFile = resolvedFile
    ? relative(workspaceRoot, resolvedFile).replaceAll(sep, '/')
    : undefined;
  const maxResults = limit ?? 20;
  const queryService = new CodegraphQueryService({ store });
  const status = queryService.status(workspaceRoot);
  const symbols = store
    .searchSymbols({ workspaceRoot, query: '', maxResults: 100 })
    .filter((symbol) => {
      const fileRecord = store.getFileById(symbol.fileId);
      return fileRecord?.relativePath === relativeFile;
    })
    .slice(0, maxResults)
    .map(
      (symbol) =>
        queryService.node({ workspaceRoot, symbolName: symbol.name, maxEdges: 1 }).symbols[0],
    )
    .filter((symbol) => symbol !== undefined);

  return {
    workspaceRoot,
    freshness: status.freshness,
    file: relativeFile,
    symbols,
    relationships: {
      incoming: [],
      outgoing: [],
    },
  };
}
