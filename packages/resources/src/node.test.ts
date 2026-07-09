import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  INTEGRATED_RESOURCE_AGENT_NAMES,
  INTEGRATED_RESOURCE_SKILL_NAMES,
  REFERENCE_ONLY_RESOURCE_AGENT_NAMES,
  REFERENCE_ONLY_SKILL_NAMES,
  RESOURCE_AGENT_TEMPLATE_NAMES,
  RESOURCE_COMMAND_NAMES,
  RESOURCE_EXTENSION_NAMES,
  RESOURCE_PROMPT_NAMES,
  RESOURCE_SKILL_NAMES,
  RESOURCE_SOUL_NAMES,
} from './catalog.js';
import {
  SYSTEM_BUILTIN_AGENT_NAMES,
  SYSTEM_BUILTIN_COMMAND_IDS,
  SYSTEM_BUILTIN_MCP_IDS,
  SYSTEM_BUILTIN_SKILL_NAMES,
} from './system-catalog.js';
import {
  createBuiltinResourceSkillDefs,
  createResourceSkillManifest,
  listIntegratedResourceAgents,
  listReferenceOnlyResourceAgents,
  listResourceCatalog,
  listResourceCenterCatalog,
  resourcePath,
} from './node.js';

describe('reference resource skills', () => {
  it('creates manifests for integrated resource skills and keeps reference-only skills disabled', () => {
    const noopExecutor = async () => ({ content: 'noop', isError: false });

    const defs = createBuiltinResourceSkillDefs(noopExecutor);
    const names = new Set(defs.map((entry) => entry.manifest.name));

    expect(defs).toHaveLength(INTEGRATED_RESOURCE_SKILL_NAMES.length);
    for (const skillName of INTEGRATED_RESOURCE_SKILL_NAMES) {
      expect(names.has(skillName)).toBe(true);
    }
    for (const skillName of REFERENCE_ONLY_SKILL_NAMES) {
      expect(names.has(skillName)).toBe(false);
    }
  });

  it('links each manifest to an existing SKILL.md resource and full model instructions', () => {
    for (const skillName of INTEGRATED_RESOURCE_SKILL_NAMES) {
      const manifest = createResourceSkillManifest(skillName);
      const skillPath = resourcePath('skills', 'reference', skillName, 'SKILL.md');

      expect(manifest.id).toBe(`com.openAwork.resource.${skillName}`);
      expect(manifest.descriptionForModel?.length ?? 0).toBeGreaterThan(300);
      expect(manifest.references?.[0]?.path).toBe(skillPath);
      expect(existsSync(skillPath)).toBe(true);
    }
  });
});

describe('resource catalog', () => {
  it('indexes non-skill resource areas with explicit integration modes', () => {
    const catalog = listResourceCatalog();

    expect(catalog.skills).toHaveLength(
      SYSTEM_BUILTIN_SKILL_NAMES.length + RESOURCE_SKILL_NAMES.length,
    );
    expect(catalog.agents).toHaveLength(
      SYSTEM_BUILTIN_AGENT_NAMES.length +
        INTEGRATED_RESOURCE_AGENT_NAMES.length +
        REFERENCE_ONLY_RESOURCE_AGENT_NAMES.length,
    );
    expect(catalog.agentTemplates).toHaveLength(RESOURCE_AGENT_TEMPLATE_NAMES.length);
    expect(catalog.commands).toHaveLength(
      SYSTEM_BUILTIN_COMMAND_IDS.length + RESOURCE_COMMAND_NAMES.length,
    );
    expect(catalog.souls).toHaveLength(RESOURCE_SOUL_NAMES.length);
    expect(catalog.prompts).toHaveLength(RESOURCE_PROMPT_NAMES.length);
    expect(catalog.extensions).toHaveLength(RESOURCE_EXTENSION_NAMES.length);
    expect(catalog.mcps).toHaveLength(SYSTEM_BUILTIN_MCP_IDS.length);

    expect(catalog.skills.filter((skill) => skill.integration === 'builtin')).toHaveLength(
      SYSTEM_BUILTIN_SKILL_NAMES.length + INTEGRATED_RESOURCE_SKILL_NAMES.length,
    );
    expect(catalog.skills.filter((skill) => skill.integration === 'reference')).toHaveLength(
      REFERENCE_ONLY_SKILL_NAMES.length,
    );
    expect(catalog.agentTemplates.every((template) => template.integration === 'reference')).toBe(
      true,
    );
    expect(catalog.commands.filter((command) => command.integration === 'builtin')).toHaveLength(
      SYSTEM_BUILTIN_COMMAND_IDS.length,
    );
    expect(catalog.commands.filter((command) => command.integration === 'reference')).toHaveLength(
      RESOURCE_COMMAND_NAMES.length,
    );
    expect(catalog.souls.every((soul) => soul.integration === 'reference')).toBe(true);
    expect(catalog.prompts.every((prompt) => prompt.integration === 'reference')).toBe(true);
    expect(catalog.extensions.every((extension) => extension.integration === 'reference')).toBe(
      true,
    );
    expect(catalog.mcps.every((mcp) => mcp.integration === 'builtin')).toBe(true);
  });

  it('exposes all resource skills in the readonly catalog without enabling reference-only skills', () => {
    const catalog = listResourceCatalog();

    expect(catalog.skills.map((skill) => skill.name).sort()).toEqual(
      [...SYSTEM_BUILTIN_SKILL_NAMES, ...RESOURCE_SKILL_NAMES].sort(),
    );
    expect(catalog.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'com.openAwork.builtin.git-master',
          name: 'git-master',
          integration: 'builtin',
        }),
        expect.objectContaining({
          id: 'com.openAwork.resource.pdf',
          name: 'pdf',
          integration: 'builtin',
        }),
        expect.objectContaining({
          id: 'resource-reference-skill-create-extension',
          name: 'create-extension',
          integration: 'reference',
          capabilities: [],
          permissions: [],
        }),
      ]),
    );
    expect(catalog.skills.every((skill) => existsSync(skill.path))).toBe(true);
    expect(catalog.skills.every((skill) => skill.content.length > 100)).toBe(true);
  });

  it('exposes system builtin agents, commands, and MCP descriptors from neutral builtin folders', () => {
    const catalog = listResourceCatalog();

    expect(catalog.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'build',
          name: 'build',
          integration: 'builtin',
        }),
        expect.objectContaining({
          id: 'oracle',
          name: 'oracle',
          integration: 'builtin',
        }),
      ]),
    );
    expect(catalog.agents.find((agent) => agent.id === 'build')?.path).toBe(
      resourcePath('agents', 'builtin', 'build.md'),
    );
    expect(catalog.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'slash-start-work',
          name: 'slash-start-work',
          integration: 'builtin',
        }),
        expect.objectContaining({
          id: 'resource-command-commit',
          name: 'commit',
          integration: 'reference',
        }),
      ]),
    );
    expect(catalog.mcps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'websearch',
          name: 'websearch',
          integration: 'builtin',
          transport: 'sse',
        }),
        expect.objectContaining({
          id: 'codegraph',
          name: 'codegraph',
          integration: 'builtin',
          transport: 'stdio',
        }),
      ]),
    );
  });

  it('promotes safe resource agents while keeping autonomous cron agent reference-only', () => {
    const integrated = listIntegratedResourceAgents();
    const referenceOnly = listReferenceOnlyResourceAgents();

    expect(integrated.map((agent) => agent.name).sort()).toEqual(
      [...INTEGRATED_RESOURCE_AGENT_NAMES].sort(),
    );
    expect(referenceOnly.map((agent) => agent.name)).toEqual([
      ...REFERENCE_ONLY_RESOURCE_AGENT_NAMES,
    ]);
    expect(integrated.every((agent) => agent.integration === 'builtin')).toBe(true);
    expect(referenceOnly.every((agent) => agent.integration === 'reference')).toBe(true);
    expect(integrated.every((agent) => agent.systemPrompt.length > 300)).toBe(true);
    expect(integrated.every((agent) => existsSync(agent.path))).toBe(true);
  });

  it('exposes workspace memory agent templates as reference-only resources', () => {
    const catalog = listResourceCatalog();

    expect(catalog.agentTemplates.map((template) => template.name).sort()).toEqual(
      [...RESOURCE_AGENT_TEMPLATE_NAMES].sort(),
    );
    expect(catalog.agentTemplates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'resource-agent-template-agents',
          name: 'AGENTS',
          title: 'AGENTS.md',
          integration: 'reference',
        }),
        expect.objectContaining({
          id: 'resource-agent-template-soul',
          name: 'SOUL',
          title: 'SOUL.md',
          integration: 'reference',
        }),
      ]),
    );
    expect(catalog.agentTemplates.every((template) => existsSync(template.path))).toBe(true);
    expect(catalog.agentTemplates.every((template) => template.content.length > 100)).toBe(true);
  });

  it('marks channel personas and workspace templates as feature resources outside the main catalog', () => {
    const catalog = listResourceCatalog();
    const centerCatalog = listResourceCenterCatalog();

    expect(catalog.souls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'resource-soul-balanced-collaborator',
          visibility: 'feature',
          feature: 'channels',
          usageKind: 'channel-persona',
        }),
      ]),
    );
    expect(catalog.agentTemplates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'resource-agent-template-soul',
          visibility: 'feature',
          feature: 'team',
          usageKind: 'agent-template',
        }),
      ]),
    );
    expect(catalog.commands.find((command) => command.id === 'resource-command-commit')).toEqual(
      expect.objectContaining({
        visibility: 'feature',
        feature: 'commands',
        usageKind: 'command-definition',
      }),
    );
    expect(centerCatalog.souls).toEqual([]);
    expect(centerCatalog.agentTemplates).toEqual([]);
    expect(centerCatalog.prompts).toEqual([]);
    expect(centerCatalog.commands.some((command) => command.integration === 'reference')).toBe(
      false,
    );
    expect(centerCatalog.skills.length).toBeGreaterThan(0);
    expect(centerCatalog.agents.length).toBeGreaterThan(0);
  });

  it('indexes extension files recursively', () => {
    const catalog = listResourceCatalog();
    const myCoffee = catalog.extensions.find((extension) => extension.name === 'my-coffee');

    expect(myCoffee?.files).toEqual(
      expect.arrayContaining([
        'extension.json',
        'index.js',
        'components/luckin-list.html',
        'components/luckin-payment.html',
        'components/luckin-summary.html',
      ]),
    );
  });
});
