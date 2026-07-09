import { randomUUID } from 'node:crypto';
import { listResourceCatalog } from '@openAwork/resources/node';
import { z } from 'zod';
import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';

export const userResourceAreaSchema = z.enum([
  'skills',
  'agents',
  'agentTemplates',
  'commands',
  'souls',
  'prompts',
  'extensions',
  'mcps',
]);

export const createUserResourceSchema = z.object({
  area: userResourceAreaSchema,
  name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, '名称只能包含字母、数字、点、下划线和连字符。'),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(400).optional().default(''),
  content: z.string().trim().min(1).max(20_000),
});

export const resourceParamsSchema = z.object({
  resourceId: z.string().trim().min(1).max(160),
});

type UserResourceArea = z.infer<typeof userResourceAreaSchema>;
type CreateUserResourceInput = z.infer<typeof createUserResourceSchema>;

interface UserResourceRow {
  readonly id: string;
  readonly area: UserResourceArea;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly content: string;
  readonly created_at: string;
  readonly updated_at: string;
}

interface UserResourceBaseEntry {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly integration: 'user';
  readonly visibility: 'catalog' | 'feature';
  readonly feature: string;
  readonly usageKind: string;
  readonly path: string;
  readonly source: 'user';
  readonly removable: true;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface UserResourceSkillEntry extends UserResourceBaseEntry {
  readonly capabilities: readonly string[];
  readonly content: string;
  readonly permissions: readonly unknown[];
}

interface UserResourceAgentEntry extends UserResourceBaseEntry {
  readonly allowedTools: readonly string[];
  readonly displayName: string;
  readonly maxIterations: number;
  readonly systemPrompt: string;
}

interface UserResourceTextEntry extends UserResourceBaseEntry {
  readonly content: string;
}

interface UserResourceCommandEntry extends UserResourceTextEntry {
  readonly contexts: readonly string[];
}

interface UserResourceExtensionEntry extends UserResourceBaseEntry {
  readonly content: string;
  readonly files: readonly string[];
}

interface UserResourceMcpEntry extends UserResourceBaseEntry {
  readonly builtinKind: 'virtual';
  readonly content: string;
  readonly enabledByDefault: false;
  readonly transport: 'stdio';
}

function resolveUserResourceUsage(area: UserResourceArea): {
  readonly visibility: 'catalog' | 'feature';
  readonly feature: string;
  readonly usageKind: string;
} {
  switch (area) {
    case 'agentTemplates':
      return { visibility: 'feature', feature: 'team', usageKind: 'agent-template' };
    case 'souls':
      return { visibility: 'feature', feature: 'channels', usageKind: 'channel-persona' };
    case 'commands':
      return { visibility: 'feature', feature: 'commands', usageKind: 'command-definition' };
    case 'prompts':
      return { visibility: 'feature', feature: 'prompts', usageKind: 'runtime-instruction' };
    case 'skills':
      return { visibility: 'catalog', feature: 'skills', usageKind: 'skill' };
    case 'agents':
      return { visibility: 'catalog', feature: 'agents', usageKind: 'agent' };
    case 'extensions':
      return { visibility: 'catalog', feature: 'extensions', usageKind: 'extension-example' };
    case 'mcps':
      return { visibility: 'catalog', feature: 'mcps', usageKind: 'mcp-server' };
  }
}

function toUserResourceBaseEntry(row: UserResourceRow): UserResourceBaseEntry {
  const usage = resolveUserResourceUsage(row.area);
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    description: row.description,
    integration: 'user',
    visibility: usage.visibility,
    feature: usage.feature,
    usageKind: usage.usageKind,
    path: `user://${row.area}/${row.id}`,
    source: 'user',
    removable: true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listUserResources(userId: string): readonly UserResourceRow[] {
  return sqliteAll<UserResourceRow>(
    `SELECT id, area, name, title, description, content, created_at, updated_at
     FROM user_resources
     WHERE user_id = ?
     ORDER BY created_at DESC`,
    [userId],
  );
}

export function createUserResource(userId: string, input: CreateUserResourceInput): void {
  sqliteRun(
    `INSERT INTO user_resources
      (id, user_id, area, name, title, description, content, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `user-resource-${randomUUID()}`,
      userId,
      input.area,
      input.name,
      input.title,
      input.description,
      input.content,
      '{}',
    ],
  );
}

export function deleteUserResource(userId: string, resourceId: string): boolean {
  const existing = sqliteGet<{ readonly id: string }>(
    'SELECT id FROM user_resources WHERE id = ? AND user_id = ? LIMIT 1',
    [resourceId, userId],
  );
  if (!existing) {
    return false;
  }
  sqliteRun('DELETE FROM user_resources WHERE id = ? AND user_id = ?', [resourceId, userId]);
  return true;
}

export function mergeUserResources(userId: string) {
  const catalog = listResourceCatalog();
  const userRows = listUserResources(userId);
  const skills: UserResourceSkillEntry[] = [];
  const agents: UserResourceAgentEntry[] = [];
  const agentTemplates: UserResourceTextEntry[] = [];
  const commands: UserResourceCommandEntry[] = [];
  const souls: UserResourceTextEntry[] = [];
  const prompts: UserResourceTextEntry[] = [];
  const extensions: UserResourceExtensionEntry[] = [];
  const mcps: UserResourceMcpEntry[] = [];

  for (const row of userRows) {
    const base = toUserResourceBaseEntry(row);
    switch (row.area) {
      case 'skills':
        skills.push({ ...base, capabilities: [], content: row.content, permissions: [] });
        break;
      case 'agents':
        agents.push({
          ...base,
          allowedTools: [],
          displayName: row.title,
          maxIterations: 0,
          systemPrompt: row.content,
        });
        break;
      case 'agentTemplates':
        agentTemplates.push({ ...base, content: row.content });
        break;
      case 'commands':
        commands.push({ ...base, content: row.content, contexts: [] });
        break;
      case 'souls':
        souls.push({ ...base, content: row.content });
        break;
      case 'prompts':
        prompts.push({ ...base, content: row.content });
        break;
      case 'extensions':
        extensions.push({ ...base, content: row.content, files: [] });
        break;
      case 'mcps':
        mcps.push({
          ...base,
          builtinKind: 'virtual',
          content: row.content,
          enabledByDefault: false,
          transport: 'stdio',
        });
        break;
    }
  }

  return {
    ...catalog,
    skills: [...catalog.skills, ...skills],
    agents: [...catalog.agents, ...agents],
    agentTemplates: [...catalog.agentTemplates, ...agentTemplates],
    commands: [...catalog.commands, ...commands],
    souls: [...catalog.souls, ...souls],
    prompts: [...catalog.prompts, ...prompts],
    extensions: [...catalog.extensions, ...extensions],
    mcps: [...catalog.mcps, ...mcps],
  };
}
