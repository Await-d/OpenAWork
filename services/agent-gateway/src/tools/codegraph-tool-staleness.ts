import { resolve } from 'node:path';
import { openCodegraphStore } from '../codegraph/store.js';
import { resolveGatewayCodegraphDatabasePath } from '../infra/storage-paths.js';
import { getSessionWorkingDirectory } from '../workspace/workspace-safety.js';
import { isPathWithinRoot } from '../workspace/workspace-paths.js';

const STALE_MARKER_LIMIT = 50;

export async function readCodegraphStaleFiles(workspaceRoot: string): Promise<string[]> {
  let store;
  try {
    store = openCodegraphStore({ databasePath: resolveGatewayCodegraphDatabasePath() });
    store.initialize();
    return store.getStaleFiles(resolve(workspaceRoot)).slice(0, STALE_MARKER_LIMIT);
  } catch (error) {
    if (error instanceof Error) {
      return [];
    }
    throw error;
  } finally {
    store?.close();
  }
}

export async function markCodegraphFilesStaleBestEffort(input: {
  readonly sessionId: string;
  readonly files: readonly string[];
  readonly reason: string;
}): Promise<void> {
  const activeRoot = getSessionWorkingDirectory(input.sessionId);
  if (!activeRoot || input.files.length === 0) {
    return;
  }

  const workspaceRoot = resolve(activeRoot);
  const scopedFiles = input.files
    .map((file) => resolve(file))
    .filter((file) => isPathWithinRoot(file, workspaceRoot))
    .slice(0, STALE_MARKER_LIMIT);
  if (scopedFiles.length === 0) {
    return;
  }

  let store;
  try {
    store = openCodegraphStore({ databasePath: resolveGatewayCodegraphDatabasePath() });
    store.initialize();
    store.markFilesStale({
      workspaceRoot,
      files: scopedFiles,
      reason: input.reason,
    });
  } catch (error) {
    if (error instanceof Error) {
      console.warn(`[codegraph] stale marker best-effort failed: ${error.message}`);
      return;
    }
    throw error;
  } finally {
    store?.close();
  }
}
