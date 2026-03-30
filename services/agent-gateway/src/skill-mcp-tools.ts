import type { ToolDefinition } from '@openAwork/agent-core';
import { MCPClientAdapterImpl } from '@openAwork/mcp-client';
import type { MCPServerRef, SkillManifest } from '@openAwork/skill-types';
import { z } from 'zod';
import { sqliteAll } from './db.js';

interface InstalledSkillRow {
  skill_id: string;
  manifest_json: string;
}

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
  description: 'Invoke MCP servers embedded by installed skills using tool/resource/prompt access.',
  inputSchema: skillMcpInputSchema,
  outputSchema: z.string(),
  timeout: 30000,
  execute: async () => {
    throw new Error('skill_mcp must execute through the gateway-managed sandbox path');
  },
};

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

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

function findSkillMcpServer(
  userId: string,
  mcpName: string,
): { manifest: SkillManifest; mcp: MCPServerRef } | null {
  const rows = sqliteAll<InstalledSkillRow>(
    `SELECT skill_id, manifest_json FROM installed_skills WHERE user_id = ? AND enabled = 1 ORDER BY updated_at DESC`,
    [userId],
  );
  const normalized = normalizeName(mcpName);
  for (const row of rows) {
    const manifest = JSON.parse(row.manifest_json) as SkillManifest;
    if (!manifest.mcp) {
      continue;
    }
    const candidates = [manifest.mcp.id, manifest.id, manifest.name, manifest.displayName]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map(normalizeName);
    if (candidates.includes(normalized)) {
      return { manifest, mcp: manifest.mcp };
    }
  }
  return null;
}

export async function runSkillMcpTool(userId: string, input: SkillMcpInput): Promise<string> {
  const found = findSkillMcpServer(userId, input.mcp_name);
  if (!found) {
    throw new Error(`MCP server "${input.mcp_name}" not found in enabled installed skills`);
  }

  const client = new MCPClientAdapterImpl();
  await client.connect(found.mcp);
  try {
    const parsedArgs = parseArguments(input.arguments);
    let result: unknown;
    if (input.tool_name) {
      result = await client.callTool(found.mcp.id, input.tool_name, parsedArgs);
    } else if (input.resource_name) {
      result = await client.readResource(found.mcp.id, input.resource_name);
    } else if (input.prompt_name) {
      const promptArgs = Object.fromEntries(
        Object.entries(parsedArgs).map(([key, value]) => [key, String(value)]),
      );
      result = await client.getPrompt(found.mcp.id, input.prompt_name, promptArgs);
    } else {
      throw new Error('No skill_mcp operation specified');
    }
    return applyGrepFilter(JSON.stringify(result, null, 2), input.grep);
  } finally {
    await client.disconnect(found.mcp.id).catch(() => undefined);
  }
}
