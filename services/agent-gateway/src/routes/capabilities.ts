import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { CapabilityDescriptor } from '@openAwork/shared';
import { formatCanonicalRole } from '@openAwork/shared';
import { requireAuth } from '../auth.js';
import { sqliteGet } from '../db.js';
import { startRequestWorkflow } from '../request-workflow.js';
import { buildCommandDescriptors } from './command-descriptors.js';
import { buildGatewayToolDefinitions } from '../tool-definitions.js';
import { BUILTIN_SKILLS } from '@openAwork/skills';
import { listEnabledAgentCapabilitiesForUser } from '../agent-catalog.js';
import { filterEnabledGatewayToolsForSession } from '../session-tool-visibility.js';

interface SessionMetadataRow {
  metadata_json: string;
}

const BUILTIN_MCPS: CapabilityDescriptor[] = [
  {
    id: 'websearch',
    kind: 'mcp',
    label: 'websearch',
    description: '网页搜索 MCP server',
    source: 'reference',
    callable: false,
    tags: ['websearch_web_search_exa'],
  },
  {
    id: 'context7',
    kind: 'mcp',
    label: 'context7',
    description: '文档检索 MCP server',
    source: 'reference',
    callable: false,
    tags: ['context7_resolve-library-id', 'context7_query-docs'],
  },
];

const REFERENCE_SKILLS: CapabilityDescriptor[] = [
  {
    id: 'playwright',
    kind: 'skill',
    label: 'playwright',
    description: 'Browser automation skill/provider entry',
    source: 'reference',
    callable: false,
  },
  {
    id: 'agent-browser',
    kind: 'skill',
    label: 'agent-browser',
    description: 'Alternative browser provider skill',
    source: 'reference',
    callable: false,
  },
  {
    id: 'playwright-cli',
    kind: 'skill',
    label: 'playwright-cli',
    description: 'CLI-backed playwright skill implementation',
    source: 'reference',
    callable: false,
  },
  {
    id: 'frontend-ui-ux',
    kind: 'skill',
    label: 'frontend-ui-ux',
    description: 'Frontend UI/UX skill',
    source: 'reference',
    callable: false,
  },
  {
    id: 'git-master',
    kind: 'skill',
    label: 'git-master',
    description: 'Git workflow skill',
    source: 'reference',
    callable: false,
  },
  {
    id: 'dev-browser',
    kind: 'skill',
    label: 'dev-browser',
    description: 'Developer browser workflow skill',
    source: 'reference',
    callable: false,
  },
];

export function listCapabilitiesForUser(
  userId: string,
  sessionId?: string,
): CapabilityDescriptor[] {
  const installedRow = sqliteGet<{ value: string }>(
    `SELECT json_group_array(manifest_json) AS value FROM installed_skills WHERE user_id = ? AND enabled = 1`,
    [userId],
  );
  const mcpRow = sqliteGet<{ value: string }>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'mcp_servers'`,
    [userId],
  );

  const installedSkills = (() => {
    try {
      const manifests = JSON.parse(installedRow?.value ?? '[]') as string[];
      return manifests.map<CapabilityDescriptor>((manifestJson) => {
        const manifest = JSON.parse(manifestJson) as {
          id: string;
          displayName?: string;
          name?: string;
          description?: string;
          capabilities?: string[];
        };
        return {
          id: manifest.id,
          kind: 'skill',
          label: manifest.displayName ?? manifest.name ?? manifest.id,
          description: manifest.description ?? '已安装技能',
          source: 'installed',
          callable: false,
          tags: manifest.capabilities ?? [],
        };
      });
    } catch {
      return [] as CapabilityDescriptor[];
    }
  })();

  const builtinSkills = BUILTIN_SKILLS.map<CapabilityDescriptor>(({ manifest }) => ({
    id: manifest.id,
    kind: 'skill',
    label: manifest.displayName,
    description: manifest.description,
    source: 'builtin',
    callable: false,
    tags: manifest.capabilities,
  }));

  const configuredMcps = (() => {
    try {
      const servers = JSON.parse(mcpRow?.value ?? '[]') as Array<{
        id?: string;
        name?: string;
        enabled?: boolean;
        type?: string;
      }>;
      return servers.map<CapabilityDescriptor>((server) => ({
        id: server.id ?? server.name ?? 'mcp',
        kind: 'mcp',
        label: server.name ?? server.id ?? 'MCP',
        description: `用户配置的 MCP server (${server.type ?? 'unknown'})`,
        source: 'configured',
        callable: false,
        enabled: server.enabled !== false,
      }));
    } catch {
      return [] as CapabilityDescriptor[];
    }
  })();

  const sessionMetadataRow = sessionId
    ? sqliteGet<SessionMetadataRow>(
        'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, userId],
      )
    : undefined;
  const visibleTools = sessionMetadataRow?.metadata_json
    ? filterEnabledGatewayToolsForSession(
        buildGatewayToolDefinitions(),
        sessionMetadataRow.metadata_json,
      )
    : buildGatewayToolDefinitions();

  const tools = visibleTools.map<CapabilityDescriptor>((tool) => ({
    id: tool.function.name,
    kind: 'tool',
    label: tool.function.name,
    description: tool.function.description,
    source: 'runtime',
    callable: true,
  }));

  const commands = buildCommandDescriptors().map<CapabilityDescriptor>((command) => ({
    id: command.id,
    kind: 'command',
    label: command.label,
    description: command.description ?? '命令',
    source: 'builtin',
    callable: true,
    tags: command.contexts,
  }));

  return [
    ...listEnabledAgentCapabilitiesForUser(userId),
    ...builtinSkills,
    ...REFERENCE_SKILLS,
    ...installedSkills,
    ...BUILTIN_MCPS,
    ...configuredMcps,
    ...tools,
    ...commands,
  ];
}

export function buildCapabilityContext(userId: string, sessionId?: string): string {
  const capabilities = listCapabilitiesForUser(userId, sessionId);
  const webSearchEnabled = sessionId
    ? (() => {
        const sessionMetadataRow = sqliteGet<SessionMetadataRow>(
          'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
          [sessionId, userId],
        );
        try {
          const metadata = sessionMetadataRow?.metadata_json
            ? (JSON.parse(sessionMetadataRow.metadata_json) as Record<string, unknown>)
            : {};
          return metadata['webSearchEnabled'] === true;
        } catch {
          return false;
        }
      })()
    : true;
  const section = (kind: CapabilityDescriptor['kind'], title: string, callableOnly = false) => {
    const items = capabilities.filter((cap) => {
      if (cap.kind !== kind) return false;
      if (callableOnly && cap.callable !== true) return false;
      if (kind === 'tool' && cap.label === 'websearch' && !webSearchEnabled) return false;
      return true;
    });
    if (items.length === 0) return '';
    return `## ${title}\n${items
      .map((item) => {
        const canonicalRole = item.canonicalRole
          ? `（规范角色：${formatCanonicalRole(item.canonicalRole)}）`
          : '';
        return `- ${item.label}: ${item.description}${canonicalRole}`;
      })
      .join('\n')}`;
  };

  return [
    '以下是当前系统的能力目录。只有“聊天可调用工具”会在本轮作为模型可调用 tool 暴露；其余条目用于描述系统能力、命令入口、已安装技能以及参考目录能力，不应被视为本轮可直接调用的 tool。',
    section('agent', '系统 Agents'),
    section('skill', '系统 Skills'),
    section('mcp', '系统 MCP Servers'),
    section('tool', '聊天可调用工具', true),
    section('command', '系统 Commands'),
  ]
    .filter(Boolean)
    .join('\n\n');
}

export async function capabilitiesRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/capabilities',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'capabilities.list');
      const user = request.user as { sub: string };
      const query = (request.query ?? {}) as { sessionId?: string };
      const capabilities = listCapabilitiesForUser(user.sub, query.sessionId);

      step.succeed(undefined, { count: capabilities.length });
      return reply.send({ capabilities });
    },
  );
}
