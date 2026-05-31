import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { CapabilityDescriptor } from '@openAwork/shared';
import { formatCanonicalRole } from '@openAwork/shared';
import { requireAuth } from '../infra/auth.js';
import { sqliteGet } from '../infra/db.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import { buildCommandDescriptors } from './command-descriptors.js';
import { buildGatewayToolDefinitions, getVisibleToolName } from '../tools/tool-definitions.js';
import { BUILTIN_SKILLS } from '@openAwork/skills';
import { listEnabledAgentCapabilitiesForUser } from '../agent/agent-catalog.js';
import { filterEnabledGatewayToolsForSession } from '../session/session-tool-visibility.js';
import {
  getEffectiveSkillsForSession,
  getEffectiveSkillsForUser,
} from '../skill/skill-selection-context.js';
import { BUILTIN_MCP_IDS } from '../mcp/builtin-mcps.js';
import { loadConfiguredMcpServersForUser } from '../mcp/mcp-runtime.js';

interface SessionMetadataRow {
  metadata_json: string;
}

// MCP 能力来自两条路径：
// - 内置 MCP（websearch / grep_app）：硬编码远程 endpoint，运行时
//   通过 `loadConfiguredMcpServersForUser` 自动合并到用户 server 列表。
//   用户可在 settings 用同 id 覆盖（含禁用）。
// - 用户配置 MCP：写在 user_settings.mcp_servers 的自定义项。
//
// REFERENCE_SKILLS（之前的虚晃 skill 占位列表）已移除，能力目录
// 精确反映"实际安装"的 skill：BUILTIN_SKILLS + installedSkills。

export function listCapabilitiesForUser(
  userId: string,
  sessionId?: string,
): CapabilityDescriptor[] {
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

  const sessionMetadataRow = sessionId
    ? sqliteGet<SessionMetadataRow>(
        'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, userId],
      )
    : undefined;
  const definitions = buildGatewayToolDefinitions({ effectiveSkills });
  const visibleTools = sessionMetadataRow?.metadata_json
    ? filterEnabledGatewayToolsForSession(definitions, sessionMetadataRow.metadata_json)
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

  return [
    ...listEnabledAgentCapabilitiesForUser(userId),
    ...builtinSkills,
    ...installedSkills,
    ...mcps,
    ...tools,
    ...commands,
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
      if (
        kind === 'tool' &&
        (cap.label === 'websearch' || cap.label === 'webfetch') &&
        !webSearchEnabled
      )
        return false;
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
