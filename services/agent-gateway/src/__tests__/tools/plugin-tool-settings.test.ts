import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayToolDefinition } from '../../tools/tool-definitions.js';

const mocks = vi.hoisted(() => ({
  sqliteGet: vi.fn(),
}));

vi.mock('../../infra/db.js', () => ({
  sqliteGet: mocks.sqliteGet,
}));

import {
  isDesktopAutomationPluginEnabledForUser,
  isDesktopControlPluginEnabledForUser,
  readPluginSettingsForUser,
} from '../../tools/plugin-tool-settings.js';
import { filterPluginControlledToolsForUser } from '../../plugin/builtin-groups.js';

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

  it('Given desktop control is enabled When filtering tools Then computer_use remains visible (G2)', () => {
    mocks.sqliteGet.mockReturnValue({
      value: JSON.stringify({ desktopControl: { enabled: true } }),
    });

    const filtered = filterPluginControlledToolsForUser(
      [tool('read'), tool('computer_use'), tool('desktop_control')],
      'user-1',
    );

    expect(filtered.map((entry) => entry.function.name)).toEqual([
      'read',
      'computer_use',
      'desktop_control',
    ]);
  });

  it('Given desktop control is disabled When filtering tools Then computer_use is hidden (G2)', () => {
    mocks.sqliteGet.mockReturnValue({
      value: JSON.stringify({ desktopControl: { enabled: false } }),
    });

    const filtered = filterPluginControlledToolsForUser(
      [tool('read'), tool('computer_use')],
      'user-1',
    );

    expect(filtered.map((entry) => entry.function.name)).toEqual(['read']);
  });

  it('Given corrupt stored JSON When reading settings Then it fails closed', () => {
    mocks.sqliteGet.mockReturnValue({ value: '{' });

    expect(readPluginSettingsForUser('user-1')).toEqual({});
    expect(isDesktopControlPluginEnabledForUser('user-1')).toBe(false);
    expect(isDesktopAutomationPluginEnabledForUser('user-1')).toBe(false);
  });

  it('Given no plugin settings When filtering tools Then desktop_automation is hidden', () => {
    mocks.sqliteGet.mockReturnValue(undefined);

    const filtered = filterPluginControlledToolsForUser(
      [tool('read'), tool('desktop_automation'), tool('desktop_control')],
      'user-1',
    );

    expect(filtered.map((entry) => entry.function.name)).toEqual(['read']);
    expect(isDesktopAutomationPluginEnabledForUser('user-1')).toBe(false);
  });

  it('Given desktop automation is enabled When filtering tools Then desktop_automation remains visible', () => {
    mocks.sqliteGet.mockReturnValue({
      value: JSON.stringify({ desktopAutomation: { enabled: true } }),
    });

    const filtered = filterPluginControlledToolsForUser(
      [tool('read'), tool('desktop_automation'), tool('desktop_control')],
      'user-1',
    );

    expect(filtered.map((entry) => entry.function.name)).toEqual(['read', 'desktop_automation']);
    expect(isDesktopAutomationPluginEnabledForUser('user-1')).toBe(true);
  });

  it('Given desktop control is enabled When filtering tools Then desktop_automation stays hidden', () => {
    mocks.sqliteGet.mockReturnValue({
      value: JSON.stringify({ desktopControl: { enabled: true } }),
    });

    const filtered = filterPluginControlledToolsForUser(
      [tool('desktop_control'), tool('desktop_automation')],
      'user-1',
    );

    expect(filtered.map((entry) => entry.function.name)).toEqual(['desktop_control']);
    expect(isDesktopAutomationPluginEnabledForUser('user-1')).toBe(false);
    expect(isDesktopControlPluginEnabledForUser('user-1')).toBe(true);
  });

  it('Given desktop automation is enabled When filtering tools Then desktop_control stays hidden', () => {
    mocks.sqliteGet.mockReturnValue({
      value: JSON.stringify({ desktopAutomation: { enabled: true } }),
    });

    const filtered = filterPluginControlledToolsForUser(
      [tool('desktop_control'), tool('computer_use'), tool('desktop_automation')],
      'user-1',
    );

    expect(filtered.map((entry) => entry.function.name)).toEqual(['desktop_automation']);
    expect(isDesktopControlPluginEnabledForUser('user-1')).toBe(false);
    expect(isDesktopAutomationPluginEnabledForUser('user-1')).toBe(true);
  });
});
