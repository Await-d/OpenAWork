/**
 * Regression (§0.116, provider-catalog corrupt-settings tolerance):
 * loadRawSettings reads the `providers` / `active_selection` user_settings rows
 * and parsed each with an unguarded JSON.parse. getCatalog sits on the main
 * chat stream path (stream.ts → getFastProvider / getProviderForSelection), so
 * a single corrupt provider row threw straight out and hard-failed EVERY chat
 * turn for that user. The parse now degrades a corrupt value to null — the same
 * path as a missing row, which getCatalog already handles by building a default
 * ProviderManagerImpl. We mock db.js so both rows hold corrupt JSON and assert
 * getCatalog resolves (does not throw) and built the default manager.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ProviderCatalogModule from '../../provider/provider-catalog.js';
import type * as AgentCoreModule from '@openAwork/agent-core';

const constructorArgs: unknown[] = [];

vi.mock('../../infra/db.js', () => ({
  // Both provider settings rows hold corrupt JSON.
  sqliteGet: () => ({ value: '{not valid json' }),
}));

vi.mock('@openAwork/agent-core', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentCoreModule>();
  class StubProviderManager {
    constructor(arg?: unknown) {
      constructorArgs.push(arg);
    }
    async syncFromModelsDev() {
      return [];
    }
    getConfig() {
      return { providers: [], active: {} };
    }
  }
  return { ...actual, ProviderManagerImpl: StubProviderManager };
});

let providerCatalog: typeof ProviderCatalogModule;

beforeEach(async () => {
  constructorArgs.length = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  providerCatalog = await import('../../provider/provider-catalog.js');
  providerCatalog.invalidateAllCatalogs();
});

describe('getCatalog corrupt user_settings resilience', () => {
  it('provider 设置行为损坏 JSON 时不抛出，降级为默认 ProviderManager', async () => {
    let entry: Awaited<ReturnType<typeof providerCatalog.getCatalog>> | undefined;

    // Must not throw despite both settings rows holding corrupt JSON.
    await expect(
      (async () => {
        entry = await providerCatalog.getCatalog('user-corrupt');
      })(),
    ).resolves.toBeUndefined();

    expect(entry).toBeDefined();
    // Corrupt rows degraded to null → getCatalog built the default manager
    // (constructor called with no argument), identical to the no-row path.
    expect(constructorArgs).toEqual([undefined]);
    expect(console.warn).toHaveBeenCalled();
  });
});
