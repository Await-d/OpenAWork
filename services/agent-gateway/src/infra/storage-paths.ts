import { join, resolve } from 'node:path';
import { createPlatformAdapter } from '@openAwork/platform-adapter';

const DEFAULT_GATEWAY_DATA_SUBDIR = 'agent-gateway';
const ALLOW_DEFAULT_TEST_DATABASE_ENV = 'OPENAWORK_ALLOW_DEFAULT_TEST_DATABASE';

function normalizeConfiguredPath(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return resolve(trimmed);
}

function normalizeConfiguredDatabasePath(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed === ':memory:') {
    return trimmed;
  }
  return resolve(trimmed);
}

export class UnsafeGatewayDatabasePathError extends Error {
  override name = 'UnsafeGatewayDatabasePathError';
}

export function resolveGatewayDataDir(): string {
  const configuredDir = normalizeConfiguredPath(process.env['OPENAWORK_DATA_DIR']);
  if (configuredDir) {
    return configuredDir;
  }

  return resolveDefaultGatewayDataDir();
}

export function resolveDefaultGatewayDataDir(): string {
  const adapter = createPlatformAdapter();
  return join(adapter.getDataDir(), DEFAULT_GATEWAY_DATA_SUBDIR);
}

export function resolveDefaultGatewayDatabasePath(): string {
  return join(resolveDefaultGatewayDataDir(), 'openAwork.db');
}

export function resolveGatewayDatabasePath(): string {
  const explicitDatabasePath = normalizeConfiguredDatabasePath(
    process.env['OPENAWORK_DATABASE_PATH'],
  );
  if (explicitDatabasePath) {
    return explicitDatabasePath;
  }

  const legacyDatabasePath = process.env['DATABASE_URL']?.trim();
  if (legacyDatabasePath) {
    return legacyDatabasePath;
  }

  return join(resolveGatewayDataDir(), 'openAwork.db');
}

export function isDefaultGatewayDatabasePath(databasePath: string): boolean {
  if (databasePath === ':memory:') {
    return false;
  }

  return resolve(databasePath) === resolve(resolveDefaultGatewayDatabasePath());
}

export function isGatewayTestRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['VITEST'] === 'true' || env['NODE_ENV'] === 'test';
}

export function assertSafeGatewayDatabasePath(
  databasePath: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (
    isGatewayTestRuntime(env) &&
    env[ALLOW_DEFAULT_TEST_DATABASE_ENV] !== '1' &&
    isDefaultGatewayDatabasePath(databasePath)
  ) {
    throw new UnsafeGatewayDatabasePathError(
      `Refusing to open the default gateway database in test runtime: ${databasePath}. ` +
        `Set DATABASE_URL=:memory: or OPENAWORK_DATABASE_PATH to an isolated test database.`,
    );
  }
}

export function resolveGatewayArtifactsDir(): string {
  return join(resolveGatewayDataDir(), 'artifacts');
}

export function resolveGatewayArtifactsIndexPath(): string {
  return join(resolveGatewayDataDir(), 'artifacts-index.json');
}

export function resolveGatewayFileBackupsDir(): string {
  return join(resolveGatewayDataDir(), 'file-backups');
}

/**
 * Cache root for the `repo_clone` / `repo_overview` tools (P1-SCOUT).
 *
 * Children paths are organised as `<host>/<owner>/<repo>` so the same
 * GitHub project always resolves to a stable absolute path across
 * sessions and processes. Mirrors opencode's `Global.Path.repos`.
 */
export function resolveGatewayReposDir(): string {
  return join(resolveGatewayDataDir(), 'repos');
}
