/**
 * Built-in plugin groups (`src/plugin/builtin-groups.ts`).
 *
 * Pins down the T-29 migration contract:
 *   1. Groups register as **guarded internal plugins** (inventory via
 *      `GET /plugins`), and registration is idempotent.
 *   2. Gating matches the historical filter: fail-closed when the
 *      setting is absent/corrupt, per-group independence, unknown tools
 *      pass through untouched.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sqliteGet: vi.fn(),
}));

vi.mock('../../infra/db.js', () => ({
  sqliteGet: mocks.sqliteGet,
}));

import {
  BUILTIN_PLUGIN_GROUPS,
  filterPluginControlledToolsForUser,
  registerBuiltinPluginGroups,
} from '../../plugin/builtin-groups.js';
import { _resetPluginRegistryForTest, getPluginRegistry } from '../../plugin/registry.js';
import { _resetPluginSupervisorForTest, isPluginGuarded } from '../../plugin/supervisor.js';

interface NamedTool {
  readonly function: { readonly name: string };
}

function tool(name: string): NamedTool {
  return { function: { name } };
}

describe('builtin plugin groups', () => {
  beforeEach(() => {
    mocks.sqliteGet.mockReset();
    _resetPluginRegistryForTest();
    _resetPluginSupervisorForTest();
  });

  it('registers the groups as guarded internal plugins (idempotent)', async () => {
    await registerBuiltinPluginGroups();
    await registerBuiltinPluginGroups(); // must not duplicate or throw

    const entries = getPluginRegistry()
      .list()
      .filter((entry) => entry.id.startsWith('builtin.'));
    expect(entries).toHaveLength(BUILTIN_PLUGIN_GROUPS.length);
    for (const entry of entries) {
      expect(entry.state.status).toBe('active');
      expect(entry.source).toBe('internal');
    }
    expect(isPluginGuarded('builtin.image-generation')).toBe(true);
    expect(isPluginGuarded('builtin.desktop-control')).toBe(true);
    expect(isPluginGuarded('builtin.desktop-automation')).toBe(true);
  });

  it('gates every group fail-closed and passes unknown tools through', () => {
    mocks.sqliteGet.mockReturnValue(undefined); // no settings → all groups off

    const filtered = filterPluginControlledToolsForUser(
      [
        tool('read'),
        tool('generate_image'),
        tool('desktop_control'),
        tool('computer_use'),
        tool('desktop_automation'),
      ],
      'user-1',
    );

    expect(filtered.map((entry) => entry.function.name)).toEqual(['read']);
  });

  it('shows a group only when its own setting is enabled', () => {
    mocks.sqliteGet.mockReturnValue({
      value: JSON.stringify({ imageGeneration: { enabled: true } }),
    });

    const filtered = filterPluginControlledToolsForUser(
      [tool('generate_image'), tool('desktop_control')],
      'user-1',
    );

    expect(filtered.map((entry) => entry.function.name)).toEqual(['generate_image']);
  });
});
