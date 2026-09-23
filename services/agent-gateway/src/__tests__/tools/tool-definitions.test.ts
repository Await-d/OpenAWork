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

  it('Agent 工具的参数携带子代理选型指引（联网资讯检索派 web-researcher）', () => {
    const definitions = buildGatewayToolDefinitions();
    const agent = definitions.find((definition) => definition.function.name === 'Agent');
    const properties = agent?.function.parameters.properties ?? {};

    // 历史现象：模型把联网新闻检索全部派给 scout（当时没有正确选项）。
    // 选型指引必须落在模型真正读到的位置：Agent 工具描述 + schema 参数说明。
    expect(agent?.function.description).toContain('web-researcher');
    expect(agent?.function.description).toContain('不要派 scout');
    expect(properties['subagent_type']).toMatchObject({
      description: expect.stringContaining('web-researcher'),
    });
    expect(properties['subagent_type']).toMatchObject({
      description: expect.stringContaining('不要派 scout'),
    });
    expect(properties['run_in_background']).toMatchObject({
      description: expect.stringContaining('task_id'),
    });
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
