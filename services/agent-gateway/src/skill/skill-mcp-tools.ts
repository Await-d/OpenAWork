import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';
import { findSkillMcpServer, skillMcpPool } from './skill-mcp-connection-pool.js';
import type { EffectiveSkill } from './skill-selection.js';

const skillMcpInputSchema = z
  .object({
    mcp_name: z.string().min(1),
    tool_name: z.string().min(1).optional(),
    resource_name: z.string().min(1).optional(),
    prompt_name: z.string().min(1).optional(),
    arguments: z.union([z.string(), z.record(z.unknown())]).optional(),
    grep: z.string().optional(),
  })
  .superRefine((value, context) => {
    const count =
      Number(Boolean(value.tool_name)) +
      Number(Boolean(value.resource_name)) +
      Number(Boolean(value.prompt_name));
    if (count !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Exactly one of tool_name, resource_name, or prompt_name must be provided',
        path: ['tool_name'],
      });
    }
  });

type SkillMcpInput = z.infer<typeof skillMcpInputSchema>;

export const skillMcpToolDefinition: ToolDefinition<typeof skillMcpInputSchema, z.ZodString> = {
  name: 'skill_mcp',
  description: '通过 tool / resource / prompt 访问已安装 skill 中内嵌的 MCP 服务器。',
  inputSchema: skillMcpInputSchema,
  outputSchema: z.string(),
  timeout: 30000,
  execute: async () => {
    throw new Error('skill_mcp must execute through the gateway-managed sandbox path');
  },
};

function parseArguments(value: SkillMcpInput['arguments']): Record<string, unknown> {
  if (!value) {
    return {};
  }
  if (typeof value === 'object' && value !== null) {
    return value;
  }
  const raw = value.startsWith("'") && value.endsWith("'") ? value.slice(1, -1) : value;
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('arguments must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

/**
 * Gate `skill_mcp` execution by the session's effective skill set so a model
 * cannot bypass workspace selection by guessing an `mcp_name`.
 *
 * Returns `true` when:
 *   - `effective` is `null` (legacy / unscoped session — preserve back-compat).
 *   - `effective` contains an enabled entry whose id / name / displayName /
 *     manifest.mcp.id matches `mcpName` (case-insensitive, trimmed).
 *
 * Returns `false` only when an effective set was provided and `mcpName` is
 * not in it. Caller should refuse the call with a user-visible error.
 */
export function isSkillMcpAllowedByEffective(
  effective: EffectiveSkill[] | null | undefined,
  mcpName: string,
): boolean {
  if (effective === null || effective === undefined) return true;
  const requested = mcpName.trim().toLowerCase();
  return effective.some((entry) => {
    if (!entry.enabled) return false;
    const candidates = [
      entry.skillId,
      entry.manifest?.id,
      entry.manifest?.name,
      entry.manifest?.displayName,
      entry.manifest?.mcp?.id,
    ];
    return candidates.some(
      (value) => typeof value === 'string' && value.trim().toLowerCase() === requested,
    );
  });
}

function applyGrepFilter(output: string, pattern: string | undefined): string {
  if (!pattern) {
    return output;
  }
  try {
    const regex = new RegExp(pattern, 'i');
    const lines = output.split('\n').filter((line) => regex.test(line));
    return lines.length > 0 ? lines.join('\n') : `[grep] No lines matched pattern: ${pattern}`;
  } catch {
    return output;
  }
}

export async function runSkillMcpTool(userId: string, input: SkillMcpInput): Promise<string> {
  const found = findSkillMcpServer(userId, input.mcp_name);
  if (!found) {
    throw new Error(`MCP server "${input.mcp_name}" not found in enabled installed skills`);
  }

  // Use connection pool with operation retry (oh-my-opencode skill-mcp-manager pattern):
  // - Lazy loading: connection created on first use, reused after
  // - Idle cleanup: disconnected after 5 min inactivity
  // - Auto-reconnect: up to 3 retries on connection errors
  const parsedArgs = parseArguments(input.arguments);
  const result = await skillMcpPool.withOperationRetry(
    userId,
    input.mcp_name,
    found.mcp,
    async (adapter, serverId) => {
      if (input.tool_name) {
        return await adapter.callTool(serverId, input.tool_name, parsedArgs);
      } else if (input.resource_name) {
        return await adapter.readResource(serverId, input.resource_name);
      } else if (input.prompt_name) {
        const promptArgs = Object.fromEntries(
          Object.entries(parsedArgs).map(([key, value]) => [key, String(value)]),
        );
        return await adapter.getPrompt(serverId, input.prompt_name, promptArgs);
      }
      throw new Error('No skill_mcp operation specified');
    },
  );
  return applyGrepFilter(JSON.stringify(result, null, 2), input.grep);
}
