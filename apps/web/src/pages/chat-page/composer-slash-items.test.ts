import { describe, expect, it } from 'vitest';
import { buildComposerSlashItems } from './composer-slash-items.js';

describe('buildComposerSlashItems', () => {
  it('given an agent with canonicalRole, when building slash items, then description includes canonical role text', () => {
    const items = buildComposerSlashItems({
      commandDescriptors: [],
      agents: [
        {
          id: 'oracle',
          kind: 'agent',
          label: 'oracle',
          description: '只读顾问 agent',
          source: 'builtin',
          canonicalRole: { coreRole: 'planner', preset: 'architect', confidence: 'medium' },
        },
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.description).toContain('规范角色：planner/architect');
  });

  it('given an agent without canonicalRole, when building slash items, then description stays unchanged', () => {
    const items = buildComposerSlashItems({
      commandDescriptors: [],
      agents: [
        {
          id: 'general',
          kind: 'agent',
          label: 'general',
          description: '通用 agent',
          source: 'builtin',
        },
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.description).toBe('通用 agent');
  });

  it('includes client-side /buddy command from the command registry', () => {
    const items = buildComposerSlashItems({
      commandDescriptors: [
        {
          id: 'slash-buddy',
          label: '/buddy',
          description: '打开 Buddy 面板',
          contexts: ['composer'],
          execution: 'client',
          action: { kind: 'open_companion_panel' },
        },
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.label).toBe('/buddy');
    expect(items[0]?.insertText).toBe('/buddy ');
  });
});
