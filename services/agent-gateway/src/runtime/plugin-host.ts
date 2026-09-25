/**
 * Plugin host (compat façade) — v2 runtime.
 *
 * The original PR-D-Plugin host lived here (env-driven V1 hook bus).
 * It now delegates to `src/plugin/*`:
 *
 *   - `plugin/hooks.ts`     — domain-keyed hook registry (hot path)
 *   - `plugin/registry.ts`  — plugin activation / lifecycle / inventory
 *   - `plugin/v1-shim.ts`   — legacy `(input, output)` hook map adapter
 *   - `packages/plugin-sdk` — plugin authoring surface (`define` + types)
 *
 * The exported surface is kept byte-compatible with the original host so
 * existing call sites (tool-sandbox, stream, stream-runner, generate) and
 * tests keep working unchanged.
 *
 * Loading rules (unchanged from the original host):
 *   - Opt-in via `OPENAWORK_PLUGINS=path1.js,@scope/pkg,...`.
 *   - Absolute / relative paths and bare package specifiers accepted.
 *   - A failing plugin logs a warning but never blocks boot.
 *   - No hot reload in this phase; adding/removing plugins restarts the
 *     gateway (hot reload lands with the discovery phase).
 *
 * Both plugin styles are accepted:
 *   - V1 (legacy): `export default async function () { return { hooks } }`
 *   - V2 (current): `export default define({ id, setup/effect })` from
 *     `@openAwork/plugin-sdk` (Promise) or `@openAwork/plugin-sdk/effect`.
 *
 * Trust model (unchanged): plugins run inside the gateway's trust
 * boundary with the same Node privileges. `OPENAWORK_PLUGINS` must only
 * point at code you control or have audited; plugins are NOT sandboxed.
 */

import type { PermissionEvaluateEvent } from '@openAwork/plugin-sdk';
import { getPluginHooks, _resetPluginHooksForTest } from '../plugin/hooks.js';
import { getPluginRegistry, _resetPluginRegistryForTest } from '../plugin/registry.js';
import {
  loadPlugins,
  startPluginHotReload,
  type HotReloadHandle,
  type TrackedPlugin,
} from '../plugin/loader.js';
import { registerBuiltinPluginGroups } from '../plugin/builtin-groups.js';
import { _resetPluginSupervisorForTest } from '../plugin/supervisor.js';
import { _resetPluginToolRegistryForTest } from '../plugin/tool-registry.js';
import type {
  PluginFactory,
  V1ChatMessageInput,
  V1ChatMessageOutput,
  V1ChatParamsInput,
  V1ChatParamsOutput,
  V1PluginHooks,
  V1ToolExecuteAfterInput,
  V1ToolExecuteAfterOutput,
  V1ToolExecuteBeforeInput,
  V1ToolExecuteBeforeOutput,
} from '../plugin/v1-shim.js';

// -----------------------------------------------------------------
// Legacy (V1) hook types — kept exported for existing call sites and
// tests. They describe the two-argument callback convention.
// -----------------------------------------------------------------

export type ToolExecuteBeforeInput = V1ToolExecuteBeforeInput;
export type ToolExecuteBeforeOutput = V1ToolExecuteBeforeOutput;
export type ToolExecuteAfterInput = V1ToolExecuteAfterInput;
export type ToolExecuteAfterOutput = V1ToolExecuteAfterOutput;
export type ChatMessageInput = V1ChatMessageInput;
export type ChatMessageOutput = V1ChatMessageOutput;
export type ChatParamsInput = V1ChatParamsInput;
export type ChatParamsOutput = V1ChatParamsOutput;

export type { PermissionEvaluateEvent };

/**
 * The V1 hook map shape. Mirrors the original host's `PluginHooks`
 * interface; the v2 SDK expresses the same hooks as domain registrations
 * on the plugin context (`ctx.tool.hook(...)` etc.).
 */
export type PluginHooks = V1PluginHooks;

/**
 * The shape a V1 plugin module's default export must produce: an async
 * factory that returns hooks.
 *
 * ```ts
 * // plugin.js (ESM, V1 style)
 * export default async function () {
 *   return {
 *     'tool.execute.before': async (input, output) => {
 *       if (input.tool === 'bash') output.args = redact(output.args);
 *     },
 *   };
 * }
 * ```
 */
export type { PluginFactory };

// -----------------------------------------------------------------
// Dispatch — one function per hook, delegating to the domain registry.
// -----------------------------------------------------------------

export async function dispatchToolExecuteBefore(
  input: ToolExecuteBeforeInput,
  output: ToolExecuteBeforeOutput,
): Promise<void> {
  const hooks = getPluginHooks();
  const event = {
    tool: input.tool,
    sessionID: input.sessionID,
    callID: input.callID,
    args: output.args,
  };
  await hooks.trigger('tool.execute.before', event);
  output.args = event.args;
}

export async function dispatchToolExecuteAfter(
  input: ToolExecuteAfterInput,
  output: ToolExecuteAfterOutput,
): Promise<void> {
  const hooks = getPluginHooks();
  const event = {
    tool: input.tool,
    sessionID: input.sessionID,
    callID: input.callID,
    args: input.args,
    output: output.output,
    metadata: output.metadata,
    ...(output.title === undefined ? {} : { title: output.title }),
  };
  await hooks.trigger('tool.execute.after', event);
  output.output = event.output;
  output.metadata = event.metadata;
  output.title = event.title;
}

export async function dispatchChatMessage(
  input: ChatMessageInput,
  output: ChatMessageOutput,
): Promise<void> {
  const hooks = getPluginHooks();
  const event = {
    sessionID: input.sessionID,
    message: output.message,
    parts: output.parts,
    ...(input.modelId === undefined ? {} : { modelId: input.modelId }),
    ...(input.messageID === undefined ? {} : { messageID: input.messageID }),
  };
  await hooks.trigger('session.prompt', event);
  output.message = event.message;
  output.parts = event.parts;
}

export async function dispatchChatParams(
  input: ChatParamsInput,
  output: ChatParamsOutput,
): Promise<void> {
  const hooks = getPluginHooks();
  const event = {
    sessionID: input.sessionID,
    modelId: input.modelId,
    temperature: output.temperature,
    topP: output.topP,
    topK: output.topK,
    maxOutputTokens: output.maxOutputTokens,
    options: output.options,
  };
  await hooks.trigger('session.context', event);
  output.temperature = event.temperature;
  output.topP = event.topP;
  output.topK = event.topK;
  output.maxOutputTokens = event.maxOutputTokens;
  output.options = event.options;
}

/**
 * Deny-only post-adjudication hook. Callers MUST run this after every
 * built-in permission verdict has been reached and MUST only honour
 * `event.effect === 'deny'` — a plugin can downgrade a decision, never
 * grant or widen one.
 */
export async function dispatchPermissionEvaluate(event: PermissionEvaluateEvent): Promise<void> {
  await getPluginHooks().trigger('permission.evaluate', event);
}

// -----------------------------------------------------------------
// Loading
// -----------------------------------------------------------------

let initialised = false;
let hotReloadHandle: HotReloadHandle | undefined;
let lastOutcome: Awaited<ReturnType<typeof loadPlugins>> | undefined;

/**
 * Resolve and activate the configured plugins (config file +
 * `<dataDir>/plugins/*` discovery + `OPENAWORK_PLUGINS` env), then start
 * hot reload for local sources. Idempotent — safe to call from multiple
 * module init paths.
 *
 * Plugin paths can be absolute files, directories with a known
 * entrypoint, relative paths (resolved against `process.cwd()`), or
 * node-style package specifiers.
 *
 * Failures (file not found, factory threw, hook shape invalid) log a
 * warning but DO NOT block boot — gateway availability always wins.
 */
export async function ensurePluginsLoaded(): Promise<void> {
  if (initialised) return;
  initialised = true;
  await refreshPluginsFromDisk();
}

/**
 * Re-scan plugin sources from disk and activate anything not yet active
 * (management API: install / uninstall / manual reload). Already-active
 * plugins are kept without re-running setup.
 */
export async function refreshPluginsFromDisk(): Promise<Awaited<ReturnType<typeof loadPlugins>>> {
  stopPluginHotReload();
  // Built-in groups are registered first so they always occupy their
  // inventory slots (guarded internal plugins; config cannot remove them).
  await registerBuiltinPluginGroups();
  const outcome = await loadPlugins();
  lastOutcome = outcome;
  if (outcome.tracked.length > 0) {
    hotReloadHandle = await startPluginHotReload(outcome);
  }
  for (const item of outcome.skipped) {
    console.warn(`[plugin] skipped "${item.spec}": ${item.reason}`);
  }
  return outcome;
}

/** Sources the loader currently tracks (active or failed). */
export function getTrackedPlugins(): readonly TrackedPlugin[] {
  return lastOutcome?.tracked ?? [];
}

/** Stop the hot-reload watcher (gateway shutdown / tests). */
export function stopPluginHotReload(): void {
  hotReloadHandle?.stop();
  hotReloadHandle = undefined;
}

// -----------------------------------------------------------------
// Test-only helpers — exported so unit tests can register synthetic
// plugins and reset state without round-tripping through the env
// variable + dynamic import dance. Production code MUST NOT call
// these from outside `__tests__`.
// -----------------------------------------------------------------

/** @internal Test only — register a synthetic V1 plugin in-process. */
export function _registerPluginForTest(source: string, hooks: PluginHooks): void {
  getPluginRegistry().activateV1(source, hooks);
}

/** @internal Test only — clear all loaded plugins (and reset init flag). */
export function _resetPluginsForTest(): void {
  stopPluginHotReload();
  _resetPluginHooksForTest();
  _resetPluginRegistryForTest();
  _resetPluginToolRegistryForTest();
  _resetPluginSupervisorForTest();
  initialised = false;
  lastOutcome = undefined;
}
