import { describe, expect, it } from 'vitest';
import type { SkillManifest } from '@openAwork/skill-types';
import { buildGatewayToolDefinitions } from '../../tools/tool-definitions.js';

describe('gateway tool definitions render contract', () => {
  it('publishes unique callable definitions with complete OpenAI function schemas', () => {
    const definitions = buildGatewayToolDefinitions();
    const names = definitions.map((definition) => definition.function.name);

    expect(definitions.length).toBeGreaterThan(20);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining(['bash', 'Skill', 'AskUserQuestion', 'Agent']));

    for (const definition of definitions) {
      expect(definition.type).toBe('function');
      expect(definition.function.name.length).toBeGreaterThan(0);
      expect(definition.function.description.length).toBeGreaterThan(0);
      expect(definition.function.parameters.type).toBe('object');
      expect(definition.function.parameters.properties).toBeDefined();
      expect(definition.function.parameters.required).toEqual(expect.any(Array));
      expect(typeof definition.function.parameters.additionalProperties).toBe('boolean');
      expect(definition.function.strict).toBe(false);
    }
  });

  it('publishes the newly added gateway tools with model-visible parameters', () => {
    const definitions = buildGatewayToolDefinitions();
    const byName = new Map(definitions.map((definition) => [definition.function.name, definition]));

    expect(byName.has('models')).toBe(true);
    expect(byName.has('session_rename')).toBe(true);
    expect(byName.has('session_move')).toBe(true);
    expect(byName.get('models')?.function.parameters.properties).toHaveProperty('query');
    expect(byName.get('session_rename')?.function.parameters.required).toContain('title');
    expect(byName.get('session_move')?.function.parameters.required).toContain('directory');
    expect(byName.get('session_move')?.function.parameters.properties).toHaveProperty('force');
  });

  it('renders the effective skill set into the visible Skill definition', () => {
    const definitions = buildGatewayToolDefinitions({
      effectiveSkills: [
        {
          skillId: 'example-skill',
          enabled: true,
          pinned: false,
          origin: 'workspace',
          manifest: {
            apiVersion: 'agent-skill/v1',
            id: 'example-skill',
            name: 'Example Skill',
            displayName: 'Example Skill',
            description: 'example',
            version: '1.0.0',
            capabilities: [],
            permissions: [],
          },
        } satisfies {
          skillId: string;
          enabled: boolean;
          pinned: boolean;
          origin: 'workspace';
          manifest: SkillManifest;
        },
      ],
    });

    const skill = definitions.find((definition) => definition.function.name === 'Skill');
    expect(skill).toBeDefined();
    expect(skill?.function.description).toContain('Example Skill');
  });
});
