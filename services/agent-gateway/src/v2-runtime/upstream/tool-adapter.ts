/**
 * Tool adapter — translate OpenAWork's `ToolDefinition[]` (the
 * canonical tool registry every agent ships with) into the AI SDK's
 * `ToolSet` shape so `streamText({ tools })` can drive execution
 * directly.
 *
 * Why this layer exists:
 *   - opencode hands its tool registry straight to AI SDK and lets
 *     `streamText` orchestrate the call/result loop. This adapter
 *     keeps the OpenAWork-side `ToolDefinition` contract intact while
 *     exposing it through AI SDK's tool surface.
 *   - The adapter is intentionally minimal — Phase C.2 scope ends at
 *     the basic call/execute mapping. Permission gating, durable
 *     closures, file diff capture, child-session task tools, and
 *     other ToolSandbox machinery remain wired through the legacy
 *     stream-model-round path until Phase B unifies them.
 *
 * Limitations (deferred to Phase B / follow-up Phase C):
 *   - No permission/UI prompt integration. Tools that require user
 *     approval must either reject inside `execute()` or stay routed
 *     through `tool-sandbox.ts`.
 *   - No tool-result middleware (e.g. file-diff capture) — the AI
 *     SDK's `execute()` returns a single value; OpenAWork's richer
 *     `ToolCallResult` (durationMs, pendingPermissionRequestId, etc.)
 *     is dropped here.
 *   - Validation: the adapter trusts `ToolDefinition.inputSchema` to
 *     validate. AI SDK uses the same zod schema, so duplicate
 *     validation is avoided.
 */

import type { ToolDefinition } from '@openAwork/agent-core';
import type { Tool, ToolSet } from 'ai';
import { jsonSchema, tool } from 'ai';
import type { JSONSchema7 } from '@ai-sdk/provider';

/**
 * Wrap a single OpenAWork `ToolDefinition` as an AI SDK `Tool`.
 *
 * The wrapper forwards `execute(input, signal)` directly. The AI SDK
 * may not always pass an abort signal (e.g. when a tool is called as
 * `onInputAvailable` outside a request scope), so we synthesise an
 * already-completed AbortController as a no-op fallback to satisfy
 * the underlying contract.
 */
export function wrapToolForAiSdk(toolDef: ToolDefinition): Tool {
  return tool({
    description: toolDef.description,
    inputSchema: toolDef.inputSchema,
    execute: async (input, options) => {
      const signal = options.abortSignal ?? new AbortController().signal;
      return toolDef.execute(input, signal);
    },
  });
}

/**
 * Wrap a list of `ToolDefinition`s as an AI SDK `ToolSet` keyed by
 * tool name. Duplicate names overwrite earlier registrations to
 * mirror `ToolRegistry.register`'s last-write-wins semantics.
 */
export function wrapToolsForAiSdk(tools: ToolDefinition[]): ToolSet {
  const set: Record<string, Tool> = {};
  for (const definition of tools) {
    set[definition.name] = wrapToolForAiSdk(definition);
  }
  return set as ToolSet;
}

/**
 * Wrap tool definitions as AI SDK declarations *without* an `execute`
 * function. AI SDK then surfaces tool-call deltas through the
 * `fullStream` and stops the model step on `finish-step` with reason
 * `tool-calls`, leaving the actual tool invocation to the caller.
 *
 * This variant is what Phase B.1 plugs into `runUpstreamStream` so the
 * existing OpenAWork agent loop (`routes/stream.ts`) keeps owning
 * permissions, sandboxing, file-diff capture, and child sessions while
 * the model side moves to AI SDK.
 */
export function wrapToolsForAiSdkDeclarationsOnly(tools: ToolDefinition[]): ToolSet {
  const set: Record<string, Tool> = {};
  for (const definition of tools) {
    set[definition.name] = tool({
      description: definition.description,
      inputSchema: definition.inputSchema,
    });
  }
  return set as ToolSet;
}

/**
 * Structural shape of `GatewayToolDefinition` that this adapter
 * relies on. Importing the real type from `tool-definitions.ts`
 * pulls in the entire gateway tool graph (sqlite, lsp, mcp), which
 * we deliberately avoid in the v2 runtime barrel — the structural
 * type below is intentionally narrower than the upstream interface.
 */
export interface GatewayToolFunctionShape {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JSONSchema7;
    strict?: boolean;
    deferLoading?: boolean;
  };
}

/**
 * Wrap a list of gateway tool definitions (the OpenAI-style
 * `function`-typed declarations the v1 path already builds) as an AI
 * SDK `ToolSet` without `execute`. AI SDK validates inputs against the
 * supplied JSON Schema and surfaces tool-call deltas through the
 * `fullStream`; the actual tool invocation stays in the existing
 * agent loop driven by `routes/stream.ts`.
 *
 * Why this complements `wrapToolsForAiSdkDeclarationsOnly`:
 *   - The reference variant takes `ToolDefinition[]` (zod-validated)
 *     and is the right call site for static, hand-written tools.
 *   - This variant takes the gateway's already-rendered JSON Schema,
 *     which covers static + dynamic + MCP + LSP + deferred tools
 *     uniformly. The Phase B.1 / B.2 v2 path consumes whatever the v1
 *     path consumes, so this is the practical bridge.
 */
export function wrapGatewayToolsForAiSdkDeclarationsOnly(
  tools: GatewayToolFunctionShape[],
): ToolSet {
  const set: Record<string, Tool> = {};
  for (const def of tools) {
    set[def.function.name] = tool({
      description: def.function.description,
      inputSchema: jsonSchema(def.function.parameters),
    });
  }
  return set as ToolSet;
}
