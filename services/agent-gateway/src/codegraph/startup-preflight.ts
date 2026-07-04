import { resolve } from 'node:path';
import type {
  CodegraphInstallManager,
  CodegraphMissingServer,
  CodegraphStartupStatusRecord,
} from './contracts.js';
import {
  buildStartupStatus,
  CODEGRAPH_CURRENT_SCHEMA_VERSION,
  openCodegraphStore,
} from './store.js';

const CODEGRAPH_REQUIRED_LSP_EXTENSIONS = new Set(['.ts', '.tsx']);

export type CodegraphStartupPreflightInput = {
  readonly databasePath: string;
  readonly workspaceRoots: readonly string[];
  readonly installManager: CodegraphInstallManager;
  readonly autoInstall: boolean;
};

export async function runCodegraphStartupPreflight(
  input: CodegraphStartupPreflightInput,
): Promise<CodegraphStartupStatusRecord> {
  let store;
  try {
    store = openCodegraphStore({ databasePath: input.databasePath });
    store.initialize();
    for (const workspaceRoot of input.workspaceRoots) {
      store.upsertWorkspaceRoot(resolve(workspaceRoot));
    }

    const beforeInstall = input.installManager.missingServers().filter(isCodegraphRequiredServer);
    const missingBeforeInstall = beforeInstall.filter((server) => !server.installed);
    const installResults =
      input.autoInstall && missingBeforeInstall.length > 0
        ? await input.installManager.ensureAllInstalled()
        : {};
    const afterInstall = input.installManager.missingServers().filter(isCodegraphRequiredServer);
    const missingAfterInstall = afterInstall.filter((server) => !server.installed);
    const missingIds = missingAfterInstall.map((server) => server.id);
    const status = buildStartupStatus({
      status: missingIds.length > 0 ? 'degraded' : 'healthy',
      missingServers: missingIds,
      installResults,
      degradedReason:
        missingIds.length > 0
          ? `missing codegraph LSP dependencies: ${missingIds.join(', ')}`
          : undefined,
    });
    store.writeStartupStatus(status);
    return status;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      checkedAtMs: Date.now(),
      status: 'degraded',
      schemaVersion: CODEGRAPH_CURRENT_SCHEMA_VERSION,
      missingServers: [],
      installResults: {},
      degradedReason: `codegraph preflight failed: ${message}`,
    };
  } finally {
    store?.close();
  }
}

export function resolveCodegraphStartupAutoInstall(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['OPENAWORK_CODEGRAPH_AUTO_INSTALL'] === '1';
}

function isCodegraphRequiredServer(server: CodegraphMissingServer): boolean {
  return server.extensions.some((extension) =>
    CODEGRAPH_REQUIRED_LSP_EXTENSIONS.has(extension.toLowerCase()),
  );
}
