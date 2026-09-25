/**
 * V1 plugin shim — adapts the original PR-D-Plugin hook map shape
 * (`(input, output)` two-argument callbacks keyed by legacy hook names)
 * onto the v2 domain registry (single mutable event object).
 *
 * Legacy → v2 hook name mapping:
 *   `tool.execute.before` → `tool.execute.before`  (field re-shape)
 *   `tool.execute.after`  → `tool.execute.after`   (field re-shape)
 *   `chat.message`        → `session.prompt`
 *   `chat.params`         → `session.context`
 *   `permission.evaluate` → `permission.evaluate`  (already single-event)
 *
 * Behaviour is preserved byte-for-byte: the shim reconstructs the
 * original two-object calling convention around each v2 event.
 */

import type { PluginHookEvents } from '@openAwork/plugin-sdk';
import type { HookRegistration, PluginHooksRegistry } from './hooks.js';

export interface V1ToolExecuteBeforeInput {
  tool: string;
  sessionID: string;
  callID: string;
}

export interface V1ToolExecuteBeforeOutput {
  args: unknown;
}

export interface V1ToolExecuteAfterInput {
  tool: string;
  sessionID: string;
  callID: string;
  args: unknown;
}

export interface V1ToolExecuteAfterOutput {
  title?: string;
  output: unknown;
  metadata: Record<string, unknown>;
}

export interface V1ChatMessageInput {
  sessionID: string;
  modelId?: string;
  messageID?: string;
}

export interface V1ChatMessageOutput {
  message: { role: string; content: unknown };
  parts: unknown[];
}

export interface V1ChatParamsInput {
  sessionID: string;
  modelId: string;
}

export interface V1ChatParamsOutput {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  options: Record<string, unknown>;
}

export interface V1PluginHooks {
  'tool.execute.before'?: (
    input: V1ToolExecuteBeforeInput,
    output: V1ToolExecuteBeforeOutput,
  ) => void | Promise<void>;
  'tool.execute.after'?: (
    input: V1ToolExecuteAfterInput,
    output: V1ToolExecuteAfterOutput,
  ) => void | Promise<void>;
  'chat.message'?: (input: V1ChatMessageInput, output: V1ChatMessageOutput) => void | Promise<void>;
  'chat.params'?: (input: V1ChatParamsInput, output: V1ChatParamsOutput) => void | Promise<void>;
  'permission.evaluate'?: (event: PluginHookEvents['permission.evaluate']) => void | Promise<void>;
}

/**
 * The shape a V1 plugin module's default export must produce: an async
 * factory that returns hooks.
 */
export type PluginFactory = (
  opts?: Record<string, unknown>,
) => Promise<V1PluginHooks> | V1PluginHooks;

/** Register every hook of a V1 hook map onto the v2 registry. */
export function registerV1Hooks(
  source: string,
  hooks: V1PluginHooks,
  registry: PluginHooksRegistry,
): HookRegistration[] {
  const registrations: HookRegistration[] = [];

  const before = hooks['tool.execute.before'];
  if (before) {
    registrations.push(
      registry.register(source, 'tool.execute.before', async (event) => {
        const output: V1ToolExecuteBeforeOutput = { args: event.args };
        await before(
          { tool: event.tool, sessionID: event.sessionID, callID: event.callID },
          output,
        );
        event.args = output.args;
      }),
    );
  }

  const after = hooks['tool.execute.after'];
  if (after) {
    registrations.push(
      registry.register(source, 'tool.execute.after', async (event) => {
        const output: V1ToolExecuteAfterOutput = {
          output: event.output,
          metadata: event.metadata,
          ...(event.title === undefined ? {} : { title: event.title }),
        };
        await after(
          {
            tool: event.tool,
            sessionID: event.sessionID,
            callID: event.callID,
            args: event.args,
          },
          output,
        );
        event.output = output.output;
        event.metadata = output.metadata;
        event.title = output.title;
      }),
    );
  }

  const message = hooks['chat.message'];
  if (message) {
    registrations.push(
      registry.register(source, 'session.prompt', async (event) => {
        const output: V1ChatMessageOutput = {
          message: event.message,
          parts: event.parts,
        };
        await message(
          {
            sessionID: event.sessionID,
            ...(event.modelId === undefined ? {} : { modelId: event.modelId }),
            ...(event.messageID === undefined ? {} : { messageID: event.messageID }),
          },
          output,
        );
        event.message = output.message;
        event.parts = output.parts;
      }),
    );
  }

  const params = hooks['chat.params'];
  if (params) {
    registrations.push(
      registry.register(source, 'session.context', async (event) => {
        const output: V1ChatParamsOutput = {
          options: event.options,
          ...(event.temperature === undefined ? {} : { temperature: event.temperature }),
          ...(event.topP === undefined ? {} : { topP: event.topP }),
          ...(event.topK === undefined ? {} : { topK: event.topK }),
          ...(event.maxOutputTokens === undefined
            ? {}
            : { maxOutputTokens: event.maxOutputTokens }),
        };
        await params({ sessionID: event.sessionID, modelId: event.modelId }, output);
        event.temperature = output.temperature;
        event.topP = output.topP;
        event.topK = output.topK;
        event.maxOutputTokens = output.maxOutputTokens;
        event.options = output.options;
      }),
    );
  }

  const permission = hooks['permission.evaluate'];
  if (permission) {
    registrations.push(
      registry.register(source, 'permission.evaluate', (event) => permission(event)),
    );
  }

  return registrations;
}
