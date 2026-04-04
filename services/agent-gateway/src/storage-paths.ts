import { join, resolve } from 'node:path';
import { createPlatformAdapter } from '@openAwork/platform-adapter';

const DEFAULT_GATEWAY_DATA_SUBDIR = 'agent-gateway';

function normalizeConfiguredPath(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return resolve(trimmed);
}

export function resolveGatewayDataDir(): string {
  const configuredDir = normalizeConfiguredPath(process.env['OPENAWORK_DATA_DIR']);
  if (configuredDir) {
    return configuredDir;
  }

  const adapter = createPlatformAdapter();
  return join(adapter.getDataDir(), DEFAULT_GATEWAY_DATA_SUBDIR);
}

export function resolveGatewayDatabasePath(): string {
  const explicitDatabasePath = normalizeConfiguredPath(process.env['OPENAWORK_DATABASE_PATH']);
  if (explicitDatabasePath) {
    return explicitDatabasePath;
  }

  const legacyDatabasePath = process.env['DATABASE_URL']?.trim();
  if (legacyDatabasePath) {
    return legacyDatabasePath;
  }

  return join(resolveGatewayDataDir(), 'openAwork.db');
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
