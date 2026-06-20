import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import {
  assertSafeGatewayDatabasePath,
  resolveGatewayDataDir,
  resolveDefaultGatewayDatabasePath,
  resolveGatewayDatabasePath,
} from '../../infra/storage-paths.js';

const ENV_KEYS = ['DATABASE_URL', 'OPENAWORK_DATABASE_PATH', 'OPENAWORK_DATA_DIR'] as const;

let originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string>>;

function restoreEnvValue(key: (typeof ENV_KEYS)[number], value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

beforeEach(() => {
  originalEnv = {};
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    restoreEnvValue(key, originalEnv[key]);
  }
});

describe('storage paths', () => {
  it('keeps DATABASE_URL=:memory: as the SQLite in-memory sentinel', () => {
    process.env['DATABASE_URL'] = ':memory:';

    expect(resolveGatewayDatabasePath()).toBe(':memory:');
  });

  it('keeps OPENAWORK_DATABASE_PATH=:memory: as the SQLite in-memory sentinel', () => {
    process.env['DATABASE_URL'] = '/tmp/legacy.db';
    process.env['OPENAWORK_DATABASE_PATH'] = ':memory:';

    expect(resolveGatewayDatabasePath()).toBe(':memory:');
  });

  it('treats OPENAWORK_DATA_DIR=:memory: as a normal data directory path', () => {
    process.env['OPENAWORK_DATA_DIR'] = ':memory:';

    expect(resolveGatewayDataDir()).toBe(resolve(':memory:'));
    expect(resolveGatewayDatabasePath()).toBe(resolve(':memory:', 'openAwork.db'));
  });

  it('rejects the default durable database in test runtime', () => {
    const defaultPath = resolveDefaultGatewayDatabasePath();

    expect(() =>
      assertSafeGatewayDatabasePath(defaultPath, {
        NODE_ENV: 'test',
      } as NodeJS.ProcessEnv),
    ).toThrow(/Refusing to open the default gateway database/);
  });

  it('allows isolated databases in test runtime', () => {
    expect(() =>
      assertSafeGatewayDatabasePath(':memory:', {
        NODE_ENV: 'test',
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
    expect(() =>
      assertSafeGatewayDatabasePath('/tmp/openawork-isolated-test.db', {
        VITEST: 'true',
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });
});
