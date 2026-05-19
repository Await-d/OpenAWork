/**
 * Dynamic Tool Loader
 *
 * Ported from opencode's tool registry dynamic loading system.
 * Scans workspace {tool,tools}/*.{js,ts} directories for user-defined tool modules
 * and registers them into the ToolSandbox at session initialization time.
 *
 * Tool module contract (matching opencode's ToolDefinition):
 *   export const myTool = {
 *     description: string,
 *     args: Record<string, ZodType>,           // zod schemas for each parameter
 *     execute: (args, ctx) => Promise<string | { output: string; metadata?: Record<string,unknown> }>
 *   }
 *
 * Or use default export:
 *   export default { description, args, execute }
 *
 * The file basename becomes the tool namespace. Named exports become `namespace_exportName`,
 * default exports become just `namespace`.
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z, type ZodTypeAny } from 'zod';
import type { ToolDefinition } from '@openAwork/agent-core';
import { truncateToolOutput } from './tool-output-truncator.js';
import type { GatewayToolDefinition } from './tool-definitions.js';

/** Shape of a user-defined tool exported from a workspace tool module. */
export interface DynamicToolDefinition {
  description: string;
  args: Record<string, ZodTypeAny>;
  execute: (
    args: Record<string, unknown>,
    ctx: DynamicToolContext,
  ) => Promise<string | { output: string; metadata?: Record<string, unknown> }>;
}

/** Minimal context passed to dynamic tool execute functions. */
export interface DynamicToolContext {
  /** Workspace root directory */
  directory: string;
  /** Session ID */
  sessionId: string;
}

/** Result of scanning and loading dynamic tools for a workspace. */
export interface DynamicToolEntry {
  /** Unique tool name (namespace + export key) */
  name: string;
  /** Tool description for the LLM */
  description: string;
  /** JSON Schema parameters object */
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: boolean;
  };
  /** Execute function wrapped for ToolSandbox compatibility */
  execute: (input: Record<string, unknown>) => Promise<unknown>;
}

/** In-memory cache keyed by workspace root → loaded tools. */
const workspaceToolCache = new Map<string, { entries: DynamicToolEntry[]; loadedAt: number }>();

/** Cache TTL in milliseconds (5 minutes). */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Maximum number of tools per workspace to prevent abuse. */
const MAX_TOOLS_PER_WORKSPACE = 50;

/** Tool name prefix to avoid collisions with builtin tools. */
const DYNAMIC_TOOL_PREFIX = 'custom_';

/**
 * Scan a workspace for dynamic tool definitions.
 * Looks for {tool,tools}/*.{js,ts} in the workspace root.
 */
async function scanToolFiles(workspaceRoot: string): Promise<string[]> {
  const toolDirs = ['tool', 'tools'];
  const extensions = new Set(['.js', '.ts', '.mjs', '.cjs']);
  const files: string[] = [];

  for (const dirName of toolDirs) {
    const dirPath = path.join(workspaceRoot, dirName);
    try {
      const stat = await fsp.stat(dirPath);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }

    try {
      const entries = await fsp.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name);
        if (!extensions.has(ext)) continue;
        files.push(path.join(dirPath, entry.name));
      }
    } catch {
      continue;
    }
  }

  return files;
}

/**
 * Convert a zod object schema to a JSON Schema parameters object.
 * Handles basic zod types; falls back to `{ type: 'string' }` for complex types.
 */
function zodArgsToJsonSchema(args: Record<string, ZodTypeAny>): {
  properties: Record<string, unknown>;
  required: string[];
} {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, schema] of Object.entries(args)) {
    const desc = schema.description;
    let prop: Record<string, unknown> = { type: 'string' };

    // Unwrap optional
    let inner = schema;
    let isOptional = false;
    if (inner instanceof z.ZodOptional || inner instanceof z.ZodDefault) {
      isOptional = true;
      inner = inner._def.innerType;
    }

    if (inner instanceof z.ZodString) {
      prop = { type: 'string' };
    } else if (inner instanceof z.ZodNumber) {
      prop = { type: 'number' };
    } else if (inner instanceof z.ZodBoolean) {
      prop = { type: 'boolean' };
    } else if (inner instanceof z.ZodEnum) {
      prop = { type: 'string', enum: inner._def.values };
    } else if (inner instanceof z.ZodArray) {
      prop = { type: 'array', items: { type: 'string' } };
    } else if (inner instanceof z.ZodObject) {
      prop = { type: 'object' };
    }

    if (desc) {
      prop.description = desc;
    }

    properties[key] = prop;

    if (!isOptional) {
      required.push(key);
    }
  }

  return { properties, required };
}

/**
 * Validate that an exported value matches the DynamicToolDefinition shape.
 */
function isDynamicToolDefinition(value: unknown): value is DynamicToolDefinition {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.description === 'string' &&
    typeof obj.args === 'object' &&
    obj.args !== null &&
    typeof obj.execute === 'function'
  );
}

/**
 * Load a single tool module file and extract tool definitions.
 */
async function loadToolModule(
  filePath: string,
  workspaceRoot: string,
  sessionId: string,
): Promise<DynamicToolEntry[]> {
  const namespace = path.basename(filePath, path.extname(filePath));
  const entries: DynamicToolEntry[] = [];

  let mod: Record<string, unknown>;
  try {
    const importPath = pathToFileURL(filePath).href;
    mod = (await import(importPath)) as Record<string, unknown>;
  } catch (err) {
    console.warn(
      `[dynamic-tool-loader] Failed to import ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }

  for (const [exportKey, exportValue] of Object.entries(mod)) {
    if (!isDynamicToolDefinition(exportValue)) continue;

    const toolName =
      exportKey === 'default'
        ? `${DYNAMIC_TOOL_PREFIX}${namespace}`
        : `${DYNAMIC_TOOL_PREFIX}${namespace}_${exportKey}`;

    const { properties, required } = zodArgsToJsonSchema(exportValue.args);

    const ctx: DynamicToolContext = {
      directory: workspaceRoot,
      sessionId,
    };

    entries.push({
      name: toolName,
      description: exportValue.description,
      parameters: {
        type: 'object',
        properties,
        required,
        additionalProperties: false,
      },
      execute: async (input: Record<string, unknown>) => {
        // Validate input against zod schema
        const schema = z.object(exportValue.args);
        const parsed = schema.parse(input);

        const result = await exportValue.execute(parsed, ctx);
        const output = typeof result === 'string' ? result : result.output;

        // Apply truncation
        return truncateToolOutput(toolName, output);
      },
    });
  }

  return entries;
}

/**
 * Load dynamic tools for a workspace. Results are cached.
 *
 * @param workspaceRoot - Absolute path to the workspace root directory
 * @param sessionId - Current session ID for tool context
 * @returns Array of discovered dynamic tool entries
 */
export async function loadDynamicToolsForWorkspace(
  workspaceRoot: string,
  sessionId: string,
): Promise<DynamicToolEntry[]> {
  // Check cache
  const cached = workspaceToolCache.get(workspaceRoot);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.entries;
  }

  const files = await scanToolFiles(workspaceRoot);
  if (files.length === 0) {
    workspaceToolCache.set(workspaceRoot, { entries: [], loadedAt: Date.now() });
    return [];
  }

  const allEntries: DynamicToolEntry[] = [];

  for (const file of files) {
    try {
      const entries = await loadToolModule(file, workspaceRoot, sessionId);
      allEntries.push(...entries);
    } catch (err) {
      console.warn(
        `[dynamic-tool-loader] Error loading tool module ${file}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Enforce limit
  const limitedEntries = allEntries.slice(0, MAX_TOOLS_PER_WORKSPACE);
  if (allEntries.length > MAX_TOOLS_PER_WORKSPACE) {
    console.warn(
      `[dynamic-tool-loader] Workspace ${workspaceRoot} has ${allEntries.length} tools, limited to ${MAX_TOOLS_PER_WORKSPACE}`,
    );
  }

  workspaceToolCache.set(workspaceRoot, { entries: limitedEntries, loadedAt: Date.now() });
  return limitedEntries;
}

/**
 * Convert a DynamicToolEntry into a ToolDefinition compatible with ToolSandbox.register().
 */
export function dynamicEntryToToolDefinition(entry: DynamicToolEntry): ToolDefinition {
  const inputSchema = z.object(
    Object.fromEntries(
      Object.entries(entry.parameters.properties).map(([key, _prop]) => [key, z.any()]),
    ),
  );

  return {
    name: entry.name,
    description: entry.description,
    inputSchema,
    outputSchema: z.any(),
    timeout: 30000,
    execute: async (input: Record<string, unknown>) => {
      return entry.execute(input);
    },
  } as unknown as ToolDefinition;
}

/**
 * Convert DynamicToolEntry array into GatewayToolDefinition format for LLM visibility.
 */
export function buildDynamicGatewayToolDefinitions(
  entries: DynamicToolEntry[],
): GatewayToolDefinition[] {
  return entries.map((entry) => ({
    type: 'function' as const,
    function: {
      name: entry.name,
      description: entry.description,
      parameters: entry.parameters,
      strict: false,
    },
  }));
}

/**
 * Invalidate the cache for a specific workspace (e.g. after file changes).
 */
export function invalidateDynamicToolCache(workspaceRoot: string): void {
  workspaceToolCache.delete(workspaceRoot);
}

/**
 * Clear the entire dynamic tool cache.
 */
export function clearDynamicToolCache(): void {
  workspaceToolCache.clear();
}

/**
 * Get the list of currently cached workspace roots.
 */
export function getCachedWorkspaceRoots(): string[] {
  return Array.from(workspaceToolCache.keys());
}
