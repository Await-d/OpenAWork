/**
 * Plugin tool registry — tools contributed by plugins through
 * `ctx.tool.transform(...)`.
 *
 * Lifecycle: tools are registered while a plugin activates and removed
 * when it unloads. Tool definitions and the sandbox are rebuilt every
 * turn, so a registration change takes effect on the next agent turn
 * without any cache invalidation.
 *
 * Safety invariants:
 *   1. Plugin tools are never mapped to a built-in permission category;
 *      the permission ladder resolves them to `custom` (default `ask`).
 *   2. Names must match `[a-zA-Z][a-zA-Z0-9_-]{0,63}` and must not
 *      collide with built-in tools (reserved names are injected by
 *      `tools/tool-definitions.ts`) or with another plugin's tool.
 *   3. Execution failures are returned as `isError` results; a plugin
 *      throwing must never break the turn.
 */

import type { PluginToolDefinition, PluginToolInfo, ToolEditor } from '@openAwork/plugin-sdk';

const TOOL_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

export interface RegisteredPluginTool {
  readonly pluginId: string;
  readonly definition: PluginToolDefinition;
}

/** Structural match for the sandbox's `ToolCallResult` (avoids a cycle). */
export interface PluginToolCallResult {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly output: unknown;
  readonly isError: boolean;
  readonly durationMs: number;
}

function validateToolDefinition(definition: PluginToolDefinition): void {
  if (typeof definition.name !== 'string' || !TOOL_NAME_PATTERN.test(definition.name)) {
    throw new Error(
      `Invalid plugin tool name "${String(definition.name)}": expected [a-zA-Z][a-zA-Z0-9_-]{0,63}.`,
    );
  }
  if (typeof definition.description !== 'string' || definition.description.trim().length === 0) {
    throw new Error(`Plugin tool "${definition.name}" must provide a non-empty description.`);
  }
  if (
    definition.input === null ||
    typeof definition.input !== 'object' ||
    definition.input.type !== 'object' ||
    definition.input.properties === null ||
    typeof definition.input.properties !== 'object'
  ) {
    throw new Error(`Plugin tool "${definition.name}" must provide an object JSON Schema input.`);
  }
  if (typeof definition.execute !== 'function') {
    throw new Error(`Plugin tool "${definition.name}" must provide an execute function.`);
  }
}

export class PluginToolRegistry {
  private readonly tools = new Map<string, RegisteredPluginTool>();
  private reservedNames: ReadonlySet<string> = new Set();

  /** Injected by `tools/tool-definitions.ts` with the built-in tool names. */
  setReservedNames(names: Iterable<string>): void {
    this.reservedNames = new Set(names);
  }

  register(pluginId: string, definition: PluginToolDefinition): void {
    validateToolDefinition(definition);
    if (this.reservedNames.has(definition.name)) {
      throw new Error(
        `Plugin tool name "${definition.name}" collides with a built-in tool; choose another name.`,
      );
    }
    const existing = this.tools.get(definition.name);
    if (existing) {
      throw new Error(
        `Plugin tool name "${definition.name}" is already registered by plugin "${existing.pluginId}".`,
      );
    }
    this.tools.set(definition.name, { pluginId, definition });
  }

  remove(name: string, pluginId: string): void {
    const entry = this.tools.get(name);
    if (entry?.pluginId === pluginId) this.tools.delete(name);
  }

  /** Remove every tool owned by a plugin (unload). */
  removeByPlugin(pluginId: string): void {
    for (const [name, entry] of [...this.tools.entries()]) {
      if (entry.pluginId === pluginId) this.tools.delete(name);
    }
  }

  get(name: string): RegisteredPluginTool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }
  list(): readonly PluginToolInfo[] {
    return [...this.tools.values()].map((entry) => ({
      name: entry.definition.name,
      description: entry.definition.description,
      pluginId: entry.pluginId,
    }));
  }

  listDefinitions(): readonly RegisteredPluginTool[] {
    return [...this.tools.values()];
  }

  /** Test-only: drop every registration (reserved names are kept). */
  reset(): void {
    this.tools.clear();
  }
}

let registryInstance: PluginToolRegistry | undefined;

export function getPluginToolRegistry(): PluginToolRegistry {
  registryInstance ??= new PluginToolRegistry();
  return registryInstance;
}

/**
 * Test-only: clear every registered tool. The reserved-name set injected
 * by `tools/tool-definitions.ts` is kept — resetting tools must not
 * disable the built-in collision guard.
 */
export function _resetPluginToolRegistryForTest(): void {
  if (registryInstance) {
    registryInstance.reset();
    return;
  }
  registryInstance = new PluginToolRegistry();
}

/** Editor handed to a plugin's `tool.transform` callback. */
export function createToolEditor(pluginId: string): ToolEditor {
  const registry = getPluginToolRegistry();
  return {
    list: () => registry.list(),
    get: (name) => registry.get(name)?.definition,
    add: (tool) => registry.register(pluginId, tool),
    remove: (name) => registry.remove(name, pluginId),
  };
}

/**
 * Convert registered plugin tools into the gateway's visible tool
 * definition shape. Consumed by `buildGatewayToolDefinitions`.
 */
export function buildPluginGatewayToolDefinitions(): {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties: boolean;
    };
    strict: boolean;
  };
}[] {
  return getPluginToolRegistry()
    .listDefinitions()
    .map((entry) => ({
      type: 'function' as const,
      function: {
        name: entry.definition.name,
        description: entry.definition.description,
        parameters: {
          type: 'object' as const,
          properties: entry.definition.input.properties,
          required: [...(entry.definition.input.required ?? [])],
          additionalProperties: entry.definition.input.additionalProperties ?? false,
        },
        strict: false,
      },
    }));
}

/**
 * Execute a plugin tool call. Failures (including thrown errors) are
 * returned as `isError` results — never propagated.
 */
export async function executePluginTool(input: {
  tool: RegisteredPluginTool;
  request: { toolCallId: string; toolName: string; rawInput: unknown };
  sessionId: string;
  signal: AbortSignal;
}): Promise<PluginToolCallResult> {
  const started = Date.now();
  try {
    const result = await input.tool.definition.execute(input.request.rawInput, {
      sessionID: input.sessionId,
      callID: input.request.toolCallId,
      signal: input.signal,
    });
    return {
      toolCallId: input.request.toolCallId,
      toolName: input.request.toolName,
      output: result.output,
      isError: result.isError === true,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    return {
      toolCallId: input.request.toolCallId,
      toolName: input.request.toolName,
      output: `Plugin tool "${input.request.toolName}" failed: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
      durationMs: Date.now() - started,
    };
  }
}
