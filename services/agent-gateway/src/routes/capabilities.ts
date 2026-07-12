import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { CapabilityDescriptor } from '@openAwork/shared';
import { formatCanonicalRole } from '@openAwork/shared';
import { z } from 'zod';
import { requireAuth } from '../infra/auth.js';
import { sqliteGet } from '../infra/db.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import { buildCommandDescriptors } from './command-descriptors.js';
import { buildGatewayToolDefinitions, getVisibleToolName } from '../tools/tool-definitions.js';
import { BUILTIN_SKILLS } from '@openAwork/skills';
import { listResourceCommandDescriptors } from '@openAwork/resources/node';
import { listEnabledAgentCapabilitiesForUser } from '../agent/agent-catalog.js';
import { filterEnabledGatewayToolsForSession } from '../session/session-tool-visibility.js';
import {
  getEffectiveSkillsForSession,
  getEffectiveSkillsForUser,
} from '../skill/skill-selection-context.js';
import { BUILTIN_MCP_IDS } from '../mcp/builtin-mcps.js';
import { loadConfiguredMcpServersForUser } from '../mcp/mcp-runtime.js';
import {
  normalizeChannelCapabilityContextPromptInjections,
  parseChannelPromptInjections,
} from '../channels/channel-prompt-injections.js';
import { resolveChannelCapabilityToolGroup } from '../channels/channel-capability-tool-groups.js';
import { SUPPORTED_CHANNEL_PLATFORMS } from '../channels/types.js';
import { parseSessionMetadataJson } from '../session/session-workspace-metadata.js';
import type { ChannelCapabilityContextPromptInjections } from '../channels/types.js';

interface SessionMetadataRow {
  metadata_json: string;
}

interface BuildCapabilityContextOptions {
  readonly sections?: Partial<ChannelCapabilityContextPromptInjections>;
}

interface ChannelCapabilityCatalogToolGroupCounts {
  web: number;
  lsp: number;
  files: number;
  shell: number;
  orchestration: number;
  session: number;
  mcp: number;
  desktop: number;
  repo: number;
  channel: number;
  other: number;
}

interface ChannelCapabilityCatalogCounts {
  readonly agents: number;
  readonly skills: number;
  readonly mcps: number;
  readonly tools: number;
  readonly toolGroups: ChannelCapabilityCatalogToolGroupCounts;
  readonly commands: number;
}

interface ChannelCapabilityPreviewInput {
  readonly type: (typeof SUPPORTED_CHANNEL_PLATFORMS)[number];
  readonly channelLlmToolsEnabled: boolean;
  readonly tools: Record<string, boolean>;
  readonly permissions: {
    readonly allowReadHome: boolean;
    readonly readablePathPrefixes: string[];
    readonly allowWriteOutside: boolean;
    readonly allowShell: boolean;
    readonly allowSubAgents: boolean;
  };
}

interface ListCapabilitiesForUserInput {
  readonly userId: string;
  readonly sessionId?: string;
  readonly sessionMetadataOverride?: Record<string, unknown>;
}

const channelCapabilityPreviewSchema = z.object({
  type: z.enum(SUPPORTED_CHANNEL_PLATFORMS),
  channelLlmToolsEnabled: z.boolean().default(false),
  tools: z.record(z.string(), z.boolean()).default({}),
  permissions: z
    .object({
      allowReadHome: z.boolean().default(false),
      readablePathPrefixes: z.array(z.string()).default([]),
      allowWriteOutside: z.boolean().default(false),
      allowShell: z.boolean().default(false),
      allowSubAgents: z.boolean().default(false),
    })
    .default(() => ({
      allowReadHome: false,
      readablePathPrefixes: [],
      allowWriteOutside: false,
      allowShell: false,
      allowSubAgents: false,
    })),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// MCP 能力来自两条路径：
// - 内置 MCP（websearch / grep_app）：硬编码远程 endpoint，运行时
//   通过 `loadConfiguredMcpServersForUser` 自动合并到用户 server 列表。
//   用户可在 settings 用同 id 覆盖（含禁用）。
// - 用户配置 MCP：写在 user_settings.mcp_servers 的自定义项。
//
// REFERENCE_SKILLS（之前的虚晃 skill 占位列表）已移除，能力目录
// 精确反映"实际安装"的 skill：BUILTIN_SKILLS + installedSkills。

function createEmptyToolGroupCounts(): ChannelCapabilityCatalogToolGroupCounts {
  return {
    web: 0,
    lsp: 0,
    files: 0,
    shell: 0,
    orchestration: 0,
    session: 0,
    mcp: 0,
    desktop: 0,
    repo: 0,
    channel: 0,
    other: 0,
  };
}

function buildCapabilityCatalogCounts(
  capabilities: readonly CapabilityDescriptor[],
): ChannelCapabilityCatalogCounts {
  const toolGroups = createEmptyToolGroupCounts();
  let agents = 0;
  let skills = 0;
  let mcps = 0;
  let tools = 0;
  let commands = 0;

  for (const capability of capabilities) {
    switch (capability.kind) {
      case 'agent':
        agents += 1;
        break;
      case 'skill':
        skills += 1;
        break;
      case 'mcp':
        if (capability.enabled !== false) {
          mcps += 1;
        }
        break;
      case 'tool':
        if (capability.callable === true) {
          tools += 1;
          toolGroups[resolveChannelCapabilityToolGroup(capability.label)] += 1;
        }
        break;
      case 'command':
        if (capability.enabled !== false) {
          commands += 1;
        }
        break;
      default:
        break;
    }
  }

  return {
    agents,
    skills,
    mcps,
    tools,
    toolGroups,
    commands,
  };
}

function buildChannelCapabilityPreviewMetadata(
  input: ChannelCapabilityPreviewInput,
): Record<string, unknown> {
  return {
    source: 'channel',
    channelLlmToolsEnabled: input.channelLlmToolsEnabled,
    channel: {
      type: input.type,
      tools: input.tools,
      permissions: input.permissions,
    },
  };
}

function buildCapabilitiesForUser(input: ListCapabilitiesForUserInput): CapabilityDescriptor[] {
  const { userId, sessionId, sessionMetadataOverride } = input;
  // Effective skills drives both the installed_skills filter and the
  // `skill` tool's description. When a sessionId is provided we resolve
  // workspace path from session metadata; otherwise we query the user's
  // global default ('__default__') selection set.
  const effectiveSkills = sessionId
    ? (getEffectiveSkillsForSession(sessionId) ??
      getEffectiveSkillsForUser({ userId, workspacePath: null }))
    : getEffectiveSkillsForUser({ userId, workspacePath: null });
  const enabledInstalledIds = new Set(
    effectiveSkills
      .filter((entry) => entry.enabled && entry.origin !== 'builtin')
      .map((entry) => entry.skillId),
  );
  const installedRow = sqliteGet<{ value: string }>(
    `SELECT json_group_array(manifest_json) AS value FROM installed_skills WHERE user_id = ? AND enabled = 1 ORDER BY skill_id`,
    [userId],
  );
  // mcp_servers 不再在这里直接读 —— 走 `loadConfiguredMcpServersForUser`
  // 拿到的是"用户配置 + 内置 MCP"合并结果，避免漏掉内置 MCP 的展示。

  const installedSkills = (() => {
    let manifests: string[];
    try {
      const parsedGroup = JSON.parse(installedRow?.value ?? '[]') as unknown;
      manifests = Array.isArray(parsedGroup)
        ? parsedGroup.filter((entry): entry is string => typeof entry === 'string')
        : [];
    } catch {
      // The outer value comes from SQLite `json_group_array` (always valid),
      // but stay defensive — a parse failure here just means "no installed
      // skills to show" rather than a thrown route.
      return [] as CapabilityDescriptor[];
    }
    // Per-manifest tolerance (§0.114 class): each `manifest_json` is persisted
    // via JSON.stringify, but a crash mid-write / disk error / hand-edited DB
    // can leave one row corrupt. Parsing inside the shared `.map` (or the outer
    // try) used to drop the user's ENTIRE installed-skill capability view on a
    // single bad row; skip the bad row individually instead.
    return manifests
      .flatMap((manifestJson) => {
        try {
          return [
            JSON.parse(manifestJson) as {
              id: string;
              displayName?: string;
              name?: string;
              description?: string;
              capabilities?: string[];
            },
          ];
        } catch (err) {
          console.warn(
            `[capabilities] installed_skills manifest_json 解析失败，已跳过：${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          return [];
        }
      })
      .filter((manifest) => enabledInstalledIds.has(manifest.id))
      .map<CapabilityDescriptor>((manifest) => ({
        id: manifest.id,
        kind: 'skill',
        label: manifest.displayName ?? manifest.name ?? manifest.id,
        description: manifest.description ?? '已安装技能',
        source: 'installed',
        callable: false,
        tags: manifest.capabilities ?? [],
      }));
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

  // MCP 能力目录走 `loadConfiguredMcpServersForUser`，它会**自动合并**
  // 内置 MCP（websearch / grep_app）与用户配置；同 id 用户配置覆盖
  // 内置项。这里不再单独读 user_settings 行，避免双份解析与漏掉
  // 内置 MCP。`mcpRow` 仅作"用户是否做过自定义"的提示信号。
  const builtinMcpIdSet = new Set<string>(BUILTIN_MCP_IDS);
  const mergedMcps = loadConfiguredMcpServersForUser(userId);
  const mcps = mergedMcps.map<CapabilityDescriptor>((server) => {
    const isBuiltin = builtinMcpIdSet.has(server.id);
    return {
      id: server.id,
      kind: 'mcp',
      label: server.name,
      description: isBuiltin
        ? `内置 MCP server（${server.transport}）`
        : `用户配置的 MCP server（${server.transport}）`,
      source: isBuiltin ? 'builtin' : 'configured',
      callable: false,
      enabled: server.enabled !== false,
    };
  });

  const sessionMetadata = sessionMetadataOverride
    ? JSON.stringify(sessionMetadataOverride)
    : sessionId
      ? sqliteGet<SessionMetadataRow>(
          'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
          [sessionId, userId],
        )?.metadata_json
      : undefined;
  const definitions = buildGatewayToolDefinitions({ effectiveSkills });
  const visibleTools = sessionMetadata
    ? filterEnabledGatewayToolsForSession(definitions, sessionMetadata)
    : definitions;

  const tools = visibleTools.map<CapabilityDescriptor>((tool) => ({
    id: getVisibleToolName(tool.function.name),
    kind: 'tool',
    label: getVisibleToolName(tool.function.name),
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
  const resourceCommands = listResourceCommandDescriptors().map<CapabilityDescriptor>(
    (command) => ({
      id: command.id,
      kind: 'command',
      label: command.title,
      description: command.description,
      source: 'reference',
      callable: false,
      tags: ['reference-resource', command.name],
    }),
  );

  return [
    ...listEnabledAgentCapabilitiesForUser(userId),
    ...builtinSkills,
    ...installedSkills,
    ...mcps,
    ...tools,
    ...commands,
    ...resourceCommands,
  ].sort((left, right) => {
    const kindOrder: Record<CapabilityDescriptor['kind'], number> = {
      agent: 0,
      skill: 1,
      mcp: 2,
      tool: 3,
      command: 4,
    };
    const kindDelta = (kindOrder[left.kind] ?? 9) - (kindOrder[right.kind] ?? 9);
    if (kindDelta !== 0) return kindDelta;
    return left.label.localeCompare(right.label, 'zh-CN');
  });
}

export function listCapabilitiesForUser(
  userId: string,
  sessionId?: string,
): CapabilityDescriptor[] {
  return buildCapabilitiesForUser({ userId, sessionId });
}

function resolveCapabilityContextSectionsFromMetadata(
  metadata: Record<string, unknown>,
): Required<ChannelCapabilityContextPromptInjections> {
  const channel = metadata['channel'];
  if (!isRecord(channel)) {
    return normalizeChannelCapabilityContextPromptInjections();
  }

  return parseChannelPromptInjections(channel['promptInjections']).capabilityContext;
}

function readSessionMetadata(userId: string, sessionId?: string): Record<string, unknown> {
  if (!sessionId) {
    return {};
  }

  const sessionMetadataRow = sqliteGet<SessionMetadataRow>(
    'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [sessionId, userId],
  );
  return parseSessionMetadataJson(sessionMetadataRow?.metadata_json ?? '{}');
}

export function buildCapabilityContext(
  userId: string,
  sessionId?: string,
  options?: BuildCapabilityContextOptions,
): string {
  const sessionMetadata = readSessionMetadata(userId, sessionId);
  const capabilities = buildCapabilitiesForUser({
    userId,
    sessionId,
    sessionMetadataOverride: sessionMetadata,
  });
  const webSearchEnabled = sessionId ? sessionMetadata['webSearchEnabled'] === true : true;
  const metadataSections = resolveCapabilityContextSectionsFromMetadata(sessionMetadata);
  const sections = normalizeChannelCapabilityContextPromptInjections({
    ...metadataSections,
    ...(options?.sections ?? {}),
  });
  const section = (kind: CapabilityDescriptor['kind'], title: string, callableOnly = false) => {
    const items = capabilities.filter((cap) => {
      if (cap.kind !== kind) return false;
      if (cap.enabled === false) return false;
      if (callableOnly && cap.callable !== true) return false;
      if (
        kind === 'tool' &&
        (cap.label === 'websearch' || cap.label === 'webfetch') &&
        !webSearchEnabled
      )
        return false;
      if (
        kind === 'tool' &&
        sections.toolGroups[resolveChannelCapabilityToolGroup(cap.label)] === false
      ) {
        return false;
      }
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

  const sectionsText = [
    sections.agents ? section('agent', '系统 Agents') : '',
    sections.skills ? section('skill', '系统 Skills') : '',
    sections.mcps ? section('mcp', '系统 MCP Servers') : '',
    sections.tools ? section('tool', '聊天可调用工具', true) : '',
    sections.commands ? section('command', '系统 Commands') : '',
  ].filter((part) => part.length > 0);

  if (sectionsText.length === 0) {
    return '';
  }

  return [
    '以下是当前系统的能力目录。只有“聊天可调用工具”会在本轮作为模型可调用 tool 暴露；其余条目用于描述系统能力、命令入口、已安装技能以及参考目录能力，不应被视为本轮可直接调用的 tool。',
    ...sectionsText,
  ].join('\n\n');
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

  app.post(
    '/capabilities/channel-preview',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'capabilities.channelPreview');
      const user = request.user as { sub: string };
      const body = channelCapabilityPreviewSchema.safeParse(request.body);
      if (!body.success) {
        step.fail('invalid input');
        return reply.status(400).send({ error: body.error.issues });
      }

      const capabilities = buildCapabilitiesForUser({
        userId: user.sub,
        sessionMetadataOverride: buildChannelCapabilityPreviewMetadata(body.data),
      });
      const counts = buildCapabilityCatalogCounts(capabilities);

      step.succeed(undefined, { toolCount: counts.tools });
      return reply.send({ counts });
    },
  );
}
