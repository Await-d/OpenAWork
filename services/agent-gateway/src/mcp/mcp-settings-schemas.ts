import { z } from 'zod';
import { buildBuiltinMcpServers, getBuiltinMcpKind, type BuiltinMcpKind } from './builtin-mcps.js';

const mcpServerSourceSchema = z.enum(['system', 'user', 'plugin']);
const builtinMcpKindSchema = z.enum(['system', 'virtual', 'adapter']);

const mcpOAuthConfigSchema = z
  .union([
    z.literal(false),
    z
      .object({
        clientId: z.string().trim().min(1).max(200).optional(),
        clientSecret: z.string().trim().min(1).max(500).optional(),
        scope: z.string().trim().min(1).max(500).optional(),
        redirectUri: z.string().trim().url().max(1000).optional(),
      })
      .strict(),
  ])
  .optional();

const mcpServerConfigSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(120),
    transport: z.enum(['sse', 'stdio']).optional(),
    type: z.enum(['sse', 'stdio']).optional(),
    url: z.string().trim().url().max(2000).optional(),
    command: z.string().trim().min(1).max(300).optional(),
    args: z.array(z.string().max(300)).max(80).optional(),
    cwd: z.string().trim().min(1).max(1000).optional(),
    env: z.record(z.string().trim().min(1).max(160), z.string().max(2000)).optional(),
    required: z.boolean().optional(),
    builtin: z.boolean().optional(),
    builtinKind: builtinMcpKindSchema.optional(),
    source: mcpServerSourceSchema.optional(),
    enabled: z.boolean().optional(),
    disabledTools: z.array(z.string().trim().min(1).max(160)).max(300).optional(),
    headers: z.record(z.string().trim().min(1).max(160), z.string().max(2000)).optional(),
    oauth: mcpOAuthConfigSchema,
  })
  .strict()
  .transform((server) => {
    const builtinKind = getBuiltinMcpKind(server.id);
    const protectedBuiltinKind = getProtectedBuiltinEndpointKind(server.id);
    if (protectedBuiltinKind !== undefined) {
      const builtin = buildBuiltinMcpServers().find((candidate) => candidate.id === server.id);
      const protectedSource = server.source ?? 'system';
      return {
        id: server.id,
        name: builtin?.name ?? server.name,
        transport: builtin?.transport ?? server.transport ?? server.type ?? 'stdio',
        builtin: true,
        builtinKind: protectedBuiltinKind,
        source: protectedSource,
        enabled: server.enabled ?? true,
        ...(server.disabledTools ? { disabledTools: [...new Set(server.disabledTools)] } : {}),
      };
    }

    const transport = server.transport ?? server.type ?? 'sse';
    const userSource = server.source === 'plugin' ? 'plugin' : 'user';
    return {
      id: server.id,
      name: server.name,
      transport,
      ...(server.url ? { url: server.url } : {}),
      ...(server.command ? { command: server.command } : {}),
      ...(server.args ? { args: server.args } : {}),
      ...(server.cwd ? { cwd: server.cwd } : {}),
      ...(server.env ? { env: server.env } : {}),
      ...(server.required !== undefined ? { required: server.required } : {}),
      ...(builtinKind !== undefined && server.builtin !== undefined
        ? { builtin: server.builtin }
        : {}),
      ...(builtinKind !== undefined ? { builtinKind } : {}),
      ...(server.source !== undefined
        ? { source: builtinKind === undefined ? userSource : server.source }
        : {}),
      enabled: server.enabled ?? true,
      ...(server.disabledTools ? { disabledTools: [...new Set(server.disabledTools)] } : {}),
      ...(server.headers ? { headers: server.headers } : {}),
      ...(server.oauth !== undefined ? { oauth: server.oauth } : {}),
    };
  })
  .superRefine((server, ctx) => {
    if (server.enabled === false) return;
    if (getProtectedBuiltinEndpointKind(server.id) !== undefined) {
      return;
    }
    const url = 'url' in server ? server.url : undefined;
    const command = 'command' in server ? server.command : undefined;
    if (server.transport === 'sse' && !url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '启用 SSE MCP 时必须提供 url。',
        path: ['url'],
      });
    }
    if (server.transport === 'stdio' && !command) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '启用 stdio MCP 时必须提供 command。',
        path: ['command'],
      });
    }
  });

export const mcpServersBodySchema = z.object({
  servers: z.array(mcpServerConfigSchema).max(100),
});

export const mcpStatusQuerySchema = z.object({
  includeTools: z
    .union([z.literal('true'), z.literal('1'), z.literal(true)])
    .optional()
    .transform((value) => value === 'true' || value === '1' || value === true),
});

export type McpServerSettingsConfig = z.output<typeof mcpServerConfigSchema>;

export function sanitizePersistedMcpServers(value: unknown): McpServerSettingsConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const normalized = normalizePersistedMcpServerEntry(entry);
    if (!normalized) {
      return [];
    }

    const parsed = mcpServerConfigSchema.safeParse(normalized);
    return parsed.success ? [parsed.data] : [];
  });
}

function getProtectedBuiltinEndpointKind(id: string): BuiltinMcpKind | undefined {
  const kind = getBuiltinMcpKind(id);
  return kind === 'virtual' || kind === 'adapter' ? kind : undefined;
}

function normalizePersistedMcpServerEntry(entry: unknown): Record<string, unknown> | undefined {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return undefined;
  }

  const record = Object.fromEntries(Object.entries(entry));
  const id = typeof record['id'] === 'string' ? record['id'].trim() : '';
  if (!id) {
    return undefined;
  }

  const name =
    typeof record['name'] === 'string' && record['name'].trim().length > 0
      ? record['name'].trim()
      : id;

  return {
    ...record,
    id,
    name,
  };
}

export function buildSettingsBuiltinMcpServers() {
  return buildBuiltinMcpServers().map((server) => ({
    builtinKind: getBuiltinMcpKind(server.id) ?? 'system',
    id: server.id,
    name: server.name,
    transport: server.transport,
    ...(getBuiltinMcpKind(server.id) === 'virtual' || getBuiltinMcpKind(server.id) === 'adapter'
      ? {}
      : {
          ...(server.url ? { url: server.url } : {}),
          ...(server.command ? { command: server.command } : {}),
        }),
    ...(server.args ? { args: server.args } : {}),
    ...(server.cwd ? { cwd: server.cwd } : {}),
    required: server.required ?? false,
    builtin: true,
    source: 'system' as const,
    enabled: server.enabled,
    ...(server.disabledTools ? { disabledTools: server.disabledTools } : {}),
    ...(server.oauth !== undefined ? { oauth: server.oauth } : {}),
  }));
}
