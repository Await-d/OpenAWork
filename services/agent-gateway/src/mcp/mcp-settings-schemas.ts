import { z } from 'zod';
import { buildBuiltinMcpServers } from './builtin-mcps.js';

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
    enabled: z.boolean().optional(),
    disabledTools: z.array(z.string().trim().min(1).max(160)).max(300).optional(),
    headers: z.record(z.string().trim().min(1).max(160), z.string().max(2000)).optional(),
    oauth: mcpOAuthConfigSchema,
  })
  .strict()
  .transform((server) => {
    const transport = server.transport ?? server.type ?? 'sse';
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
      ...(server.builtin !== undefined ? { builtin: server.builtin } : {}),
      enabled: server.enabled ?? true,
      ...(server.disabledTools ? { disabledTools: [...new Set(server.disabledTools)] } : {}),
      ...(server.headers ? { headers: server.headers } : {}),
      ...(server.oauth !== undefined ? { oauth: server.oauth } : {}),
    };
  })
  .superRefine((server, ctx) => {
    if (server.enabled === false) return;
    if (server.transport === 'sse' && !server.url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '启用 SSE MCP 时必须提供 url。',
        path: ['url'],
      });
    }
    if (server.transport === 'stdio' && !server.command) {
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

export function buildSettingsBuiltinMcpServers() {
  return buildBuiltinMcpServers().map((server) => ({
    id: server.id,
    name: server.name,
    transport: server.transport,
    ...(server.url ? { url: server.url } : {}),
    ...(server.command ? { command: server.command } : {}),
    ...(server.args ? { args: server.args } : {}),
    ...(server.cwd ? { cwd: server.cwd } : {}),
    required: server.required ?? false,
    builtin: true,
    enabled: server.enabled,
    ...(server.disabledTools ? { disabledTools: server.disabledTools } : {}),
    ...(server.oauth !== undefined ? { oauth: server.oauth } : {}),
  }));
}
