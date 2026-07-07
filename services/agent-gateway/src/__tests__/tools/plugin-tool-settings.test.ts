import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayToolDefinition } from '../../tools/tool-definitions.js';

const mocks = vi.hoisted(() => ({
  sqliteGet: vi.fn(),
}));

vi.mock('../../infra/db.js', () => ({
  sqliteGet: mocks.sqliteGet,
}));

import {
  filterPluginControlledToolsForUser,
  isDesktopControlPluginEnabledForUser,
  readPluginSettingsForUser,
} from '../../tools/plugin-tool-settings.js';

function tool(name: string): GatewayToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      description: `${name} tool`,
      strict: true,
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  };
}

describe('plugin tool settings', () => {
  beforeEach(() => {
    mocks.sqliteGet.mockReset();
  });

  it('Given no plugin settings When filtering tools Then plugin-controlled tools are hidden', () => {
    mocks.sqliteGet.mockReturnValue(undefined);

    const filtered = filterPluginControlledToolsForUser(
      [tool('read'), tool('generate_image'), tool('desktop_control')],
      'user-1',
    );

    expect(filtered.map((entry) => entry.function.name)).toEqual(['read']);
  });

  it('Given desktop control is enabled When filtering tools Then desktop_control remains visible', () => {
    mocks.sqliteGet.mockReturnValue({
      value: JSON.stringify({ desktopControl: { enabled: true } }),
    });

    const filtered = filterPluginControlledToolsForUser(
      [tool('read'), tool('generate_image'), tool('desktop_control')],
      'user-1',
    );

    expect(filtered.map((entry) => entry.function.name)).toEqual(['read', 'desktop_control']);
    expect(isDesktopControlPluginEnabledForUser('user-1')).toBe(true);
  });

  it('Given corrupt stored JSON When reading settings Then it fails closed', () => {
    mocks.sqliteGet.mockReturnValue({ value: '{' });

    expect(readPluginSettingsForUser('user-1')).toEqual({});
    expect(isDesktopControlPluginEnabledForUser('user-1')).toBe(false);
  });
});
