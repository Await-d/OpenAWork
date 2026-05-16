import { formatCanonicalRole } from '@openAwork/shared';
import type { CommandDescriptor } from '@openAwork/shared';
import type {
  ComposerAgentTool,
  ComposerCapabilityItem,
  InstalledComposerSkill,
  SlashCommandItem,
} from './support.js';
import { createServerSlashCommandItem } from './server-command-item.js';

function describeCapability(agent: ComposerCapabilityItem): string {
  const canonicalRole = agent.canonicalRole ? formatCanonicalRole(agent.canonicalRole) : null;
  return canonicalRole ? `${agent.description} · 规范角色：${canonicalRole}` : agent.description;
}

interface BuildComposerSlashItemsParams {
  agents?: ComposerCapabilityItem[];
  agentTools?: ComposerAgentTool[];
  commandDescriptors: CommandDescriptor[];
  installedSkills?: InstalledComposerSkill[];
  mcpServers?: ComposerCapabilityItem[];
}

export function buildComposerSlashItems(params: BuildComposerSlashItemsParams): SlashCommandItem[] {
  const commandItems = params.commandDescriptors.map((command) =>
    createServerSlashCommandItem(command),
  );

  const skillItems = (params.installedSkills ?? []).map<SlashCommandItem>((skill) => ({
    id: `skill:${skill.id}`,
    kind: 'slash',
    source: 'skill',
    type: 'insert',
    label: skill.label,
    description: skill.description,
    badgeLabel: skill.source === 'reference' ? '参考技能' : '技能',
    insertText: `使用技能「${skill.label}」：`,
    onSelect: async () => undefined,
  }));

  const toolItems = (params.agentTools ?? []).map<SlashCommandItem>((tool) => ({
    id: `tool:${tool.name}`,
    kind: 'slash',
    source: 'tool',
    type: 'insert',
    label: tool.name,
    description: tool.description,
    badgeLabel: '工具',
    insertText: `使用 Agent 工具「${tool.name}」：`,
    onSelect: async () => undefined,
  }));

  const agentItems = (params.agents ?? []).map<SlashCommandItem>((agent) => ({
    id: `agent:${agent.id}`,
    kind: 'slash',
    source: 'agent',
    type: 'insert',
    label: agent.label,
    description: describeCapability(agent),
    badgeLabel: agent.source === 'custom' ? '自定义Agent' : '内置Agent',
    insertText: `使用 Agent「${agent.label}」：`,
    onSelect: async () => undefined,
  }));

  const mcpItems = (params.mcpServers ?? []).map<SlashCommandItem>((mcp) => ({
    id: `mcp:${mcp.id}`,
    kind: 'slash',
    source: 'mcp',
    type: 'insert',
    label: mcp.label,
    description: mcp.description,
    badgeLabel: mcp.source === 'reference' ? '参考MCP' : 'MCP',
    insertText: `使用 MCP「${mcp.label}」：`,
    onSelect: async () => undefined,
  }));

  return [...commandItems, ...skillItems, ...toolItems, ...agentItems, ...mcpItems];
}
