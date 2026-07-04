import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { CodegraphQueryService } from '../../codegraph/query-service.js';
import { runCodegraphStartupPreflight } from '../../codegraph/startup-preflight.js';
import { openCodegraphStore } from '../../codegraph/store.js';
import type { CodegraphInstallManager, CodegraphMissingServer } from '../../codegraph/contracts.js';

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'openawork-codegraph-preflight-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  const dirs = tempDirs.splice(0);
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

class HealthyInstallManager implements CodegraphInstallManager {
  ensureAllCalls = 0;

  missingServers(): readonly CodegraphMissingServer[] {
    return [];
  }

  async ensureAllInstalled(): Promise<Record<string, boolean>> {
    this.ensureAllCalls += 1;
    return {};
  }
}

class MissingInstallManager implements CodegraphInstallManager {
  ensureAllCalls = 0;

  missingServers(): readonly CodegraphMissingServer[] {
    return [
      {
        id: 'typescript',
        extensions: ['.ts', '.tsx'],
        binary: 'typescript-language-server',
        installCommand: 'pnpm add -g typescript-language-server',
        installed: false,
      },
    ];
  }

  async ensureAllInstalled(): Promise<Record<string, boolean>> {
    this.ensureAllCalls += 1;
    return { typescript: false };
  }
}

class MissingNonCodegraphInstallManager implements CodegraphInstallManager {
  ensureAllCalls = 0;

  missingServers(): readonly CodegraphMissingServer[] {
    return [
      {
        id: 'gopls',
        extensions: ['.go'],
        binary: 'gopls',
        installed: false,
      },
      {
        id: 'rust-analyzer',
        extensions: ['.rs'],
        binary: 'rust-analyzer',
        installed: false,
      },
      {
        id: 'dockerfile',
        extensions: ['dockerfile'],
        binary: 'docker-langserver',
        installed: false,
      },
    ];
  }

  async ensureAllInstalled(): Promise<Record<string, boolean>> {
    this.ensureAllCalls += 1;
    return {};
  }
}

describe('runCodegraphStartupPreflight', () => {
  it('initializes storage and reports healthy without install when dependencies exist', async () => {
    // Given
    const dir = await createTempDir();
    const manager = new HealthyInstallManager();
    const databasePath = join(dir, 'cache/codegraph.sqlite');

    // When
    const result = await runCodegraphStartupPreflight({
      databasePath,
      workspaceRoots: [join(dir, 'workspace')],
      installManager: manager,
      autoInstall: true,
    });

    // Then
    expect(result.status).toBe('healthy');
    expect(manager.ensureAllCalls).toBe(0);
    const store = openCodegraphStore({ databasePath });
    try {
      store.initialize();
      expect(store.readStartupStatus()?.status).toBe('healthy');
    } finally {
      store.close();
    }
  });

  it('uses existing bounded install helpers only when enabled and persists degraded status', async () => {
    // Given
    const dir = await createTempDir();
    const manager = new MissingInstallManager();
    const databasePath = join(dir, 'cache/codegraph.sqlite');

    // When
    const result = await runCodegraphStartupPreflight({
      databasePath,
      workspaceRoots: [join(dir, 'workspace')],
      installManager: manager,
      autoInstall: true,
    });

    // Then
    expect(result.status).toBe('degraded');
    expect(manager.ensureAllCalls).toBe(1);
    expect(result.degradedReason).toContain('typescript');
    const store = openCodegraphStore({ databasePath });
    try {
      store.initialize();
      const queryService = new CodegraphQueryService({ store });
      expect(queryService.status(join(dir, 'workspace')).startup.status).toBe('degraded');
    } finally {
      store.close();
    }
  });

  it('ignores missing LSP servers outside the TypeScript codegraph surface', async () => {
    // Given
    const dir = await createTempDir();
    const manager = new MissingNonCodegraphInstallManager();
    const databasePath = join(dir, 'cache/codegraph.sqlite');

    // When
    const result = await runCodegraphStartupPreflight({
      databasePath,
      workspaceRoots: [join(dir, 'workspace')],
      installManager: manager,
      autoInstall: true,
    });

    // Then
    expect(result.status).toBe('healthy');
    expect(result.missingServers).toEqual([]);
    expect(manager.ensureAllCalls).toBe(0);
  });

  it('converts codegraph-only storage failures into degraded status instead of throwing', async () => {
    // Given
    const dir = await createTempDir();
    const manager = new HealthyInstallManager();

    // When
    const result = await runCodegraphStartupPreflight({
      databasePath: dir,
      workspaceRoots: [join(dir, 'workspace')],
      installManager: manager,
      autoInstall: false,
    });

    // Then
    expect(result.status).toBe('degraded');
    expect(result.degradedReason).toContain('codegraph preflight failed');
  });
});
