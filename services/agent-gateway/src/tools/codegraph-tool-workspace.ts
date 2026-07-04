import { stat } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import type { z } from 'zod';
import { resolveGatewayCodegraphDatabasePath } from '../infra/storage-paths.js';
import { getSessionWorkingDirectory } from '../workspace/workspace-safety.js';
import { isPathWithinRoot } from '../workspace/workspace-paths.js';
import type { boundedDegradedOutputSchema } from './codegraph-tool-schemas.js';
import { readCodegraphStaleFiles } from './codegraph-tool-staleness.js';

export function resolveCodegraphCachePath(): string {
  return resolveGatewayCodegraphDatabasePath();
}

export function buildDefinitionFallback(
  workspaceRoot: string | undefined,
): z.infer<typeof boundedDegradedOutputSchema> {
  return {
    status: 'not_available',
    workspaceRoot: workspaceRoot ? resolve(workspaceRoot) : '',
    cachePath: resolveCodegraphCachePath(),
    freshness: {
      status: 'unknown',
      staleFiles: [],
    },
    degradedReason:
      'codegraph 工具必须经 gateway tool sandbox 执行，直接 registry execution 无 session active workspace。',
    nextAction:
      '通过会话工具调用重试；如果仍不可用，使用 lsp_*、ast_grep_search、grep、read fallback。',
  };
}

export function resolveActiveWorkspaceRoot(sessionId: string, workspaceRoot?: string): string {
  const activeRoot = getSessionWorkingDirectory(sessionId);
  if (!activeRoot) {
    throw new Error(`当前会话未绑定工作区，无法执行 codegraph 工具。请先设置 workingDirectory。`);
  }

  const resolvedActiveRoot = resolve(activeRoot);
  if (!workspaceRoot) {
    return resolvedActiveRoot;
  }

  const resolvedInputRoot = resolve(workspaceRoot);
  if (!isPathWithinRoot(resolvedInputRoot, resolvedActiveRoot)) {
    throw new Error(`codegraph workspaceRoot 必须位于当前 active workspace 内：${workspaceRoot}`);
  }
  return resolvedInputRoot;
}

export function resolveCodegraphScopedPath(workspaceRoot: string, path: string): string {
  const resolved = resolve(workspaceRoot, path);
  if (!isPathWithinRoot(resolved, workspaceRoot)) {
    throw new Error(`codegraph path 必须位于当前 active workspace 内：${path}`);
  }
  return resolved;
}

export async function buildDegradedOutput(input: {
  sessionId: string;
  workspaceRoot?: string;
  path?: string;
  reason?: string;
}): Promise<z.infer<typeof boundedDegradedOutputSchema>> {
  const workspaceRoot = resolveActiveWorkspaceRoot(input.sessionId, input.workspaceRoot);
  if (input.path) {
    const scoped = resolveCodegraphScopedPath(workspaceRoot, input.path);
    await stat(scoped).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return null;
      }
      throw error;
    });
  }

  const staleFiles = await readCodegraphStaleFiles(workspaceRoot);
  const relativeStaleFiles = staleFiles.map((file) =>
    relative(workspaceRoot, file).replaceAll(sep, '/'),
  );
  return {
    status: 'not_available',
    workspaceRoot,
    cachePath: resolveCodegraphCachePath(),
    freshness: {
      status: relativeStaleFiles.length > 0 ? 'stale' : 'not_indexed',
      staleFiles: relativeStaleFiles,
    },
    degradedReason:
      input.reason ?? 'codegraph 核心索引/查询服务尚未加载；当前工具只提供边界校验和降级状态。',
    nextAction:
      '先使用 lsp_*、ast_grep_search、grep、read 作为 fallback；待 codegraph 核心服务可用后重新运行 codegraph_index。',
  };
}
