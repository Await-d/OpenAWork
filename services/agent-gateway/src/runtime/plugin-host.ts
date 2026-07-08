/**
 * Plugin host (PR-D-Plugin) — opencode-style hook bus.
 *
 * Inspiration: `@/temp/opencode/packages/plugin/src/index.ts`'s
 * `Hooks` interface. We expose a curated subset that matches the
 * surface area OpenAWork's stream + sandbox can hook today; the
 * remaining hooks (permission, auth, provider, experimental) stay
 * as documented extension points.
 *
 * **Architecture invariants** (do NOT regress these):
 *
 *   1. Hooks operate on **mutable output objects**. Convention from
 *      opencode: the hook receives `(input, output)`, mutates
 *      `output` in place, and returns void. This keeps the call
 *      sites simple (`output.args = sanitise(output.args)`) and
 *      composable (multiple plugins can stack their changes
 *      naturally without async-pipe ceremony).
 *
 *   2. Hook errors NEVER break the main flow. Each plugin invocation
 *      is wrapped in try/catch + `console.warn`. A misbehaving
 *      plugin must not be able to crash a chat turn or bypass
 *      sandbox safety. If a plugin throws, its mutations to
 *      `output` are still applied up to the point of throw — same
 *      semantics as opencode.
 *
 *   3. Plugin loading is **opt-in via env**. We don't auto-load any
 *      paths; operators set `OPENAWORK_PLUGINS=path1.js,path2.js`
 *      explicitly. This avoids surprising production deployments
 *      that didn't audit a third-party plugin.
 *
 *   4. Each plugin is loaded once at module init via dynamic ESM
 *      `import()`. Hot-reload is intentionally NOT supported in this
 *      MVP — plugins inspect their config and short-circuit when
 *      they're disabled, but adding/removing plugins requires a
 *      gateway restart.
 *
 * **Trust model — read before writing a plugin or auditing one:**
 *
 *   Plugins run **inside the gateway's trust boundary**, with the
 *   same Node.js privileges as the gateway process itself
 *   (filesystem, network, environment variables, sqlite). They are
 *   NOT sandboxed.
 *
 *   In particular, `tool.execute.before` runs only after the sandbox
 *   has accepted the requested tool name. Its mutated `args` are then
 *   passed through workspace validation, permission context building,
 *   execution, and audit logging. It cannot create a new executable
 *   tool or skip the sandbox gates, but a malicious plugin can still
 *   change what an allowed tool is asked to do.
 *
 *   Consequences for operators:
 *     - `OPENAWORK_PLUGINS` MUST only point at code you control or
 *       have audited.
 *     - Don't load plugins from user-writable directories.
 *     - Treat plugin paths the same way you treat the gateway's own
 *       deployment artifacts.
 */

import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';

/**
 * `tool.execute.before` — called immediately before a tool's
 * execution function runs. Plugins can mutate `output.args` to
 * sanitise / redact / inject defaults. The original
 * `request.rawInput` is replaced with `output.args` for the
 * downstream execution (matching opencode's contract).
 */
export interface ToolExecuteBeforeInput {
  tool: string;
  sessionID: string;
  callID: string;
}

export interface ToolExecuteBeforeOutput {
  args: unknown;
}

/**
 * `tool.execute.after` — called once the tool returns (or throws).
 * Plugins can mutate the output text / title / metadata. Errors
 * thrown by the tool itself surface as `output.output` containing
 * the error string and `metadata.isError = true`.
 */
export interface ToolExecuteAfterInput {
  tool: string;
  sessionID: string;
  callID: string;
  args: unknown;
}

export interface ToolExecuteAfterOutput {
  title?: string;
  output: unknown;
  metadata: Record<string, unknown>;
}

/**
 * `chat.message` — called when a new user message is being
 * processed. Plugins can read but should not mutate (the parts
 * array is passed by reference but is treated as advisory in this
 * MVP — future revisions may allow rewriting).
 */
export interface ChatMessageInput {
  sessionID: string;
  modelId?: string;
  messageID?: string;
}

export interface ChatMessageOutput {
  message: { role: string; content: unknown };
  parts: unknown[];
}

/**
 * `chat.params` — called right before the gateway dispatches the
 * model request. Plugins can override sampling parameters (e.g.
 * coerce all GPT-5 calls to temperature 0 in a deterministic-test
 * environment).
 */
export interface ChatParamsInput {
  sessionID: string;
  modelId: string;
}

export interface ChatParamsOutput {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  options: Record<string, unknown>;
}

export interface PluginHooks {
  'tool.execute.before'?: (
    input: ToolExecuteBeforeInput,
    output: ToolExecuteBeforeOutput,
  ) => void | Promise<void>;
  'tool.execute.after'?: (
    input: ToolExecuteAfterInput,
    output: ToolExecuteAfterOutput,
  ) => void | Promise<void>;
  'chat.message'?: (input: ChatMessageInput, output: ChatMessageOutput) => void | Promise<void>;
  'chat.params'?: (input: ChatParamsInput, output: ChatParamsOutput) => void | Promise<void>;
}

/**
 * The shape a plugin module's default export must produce. Mirrors
 * opencode's `Plugin` type: an async factory that returns hooks.
 *
 * ```ts
 * // plugin.js (ESM)
 * export default async function () {
 *   return {
 *     'tool.execute.before': async (input, output) => {
 *       if (input.tool === 'bash') output.args = redact(output.args);
 *     },
 *   };
 * }
 * ```
 */
export type PluginFactory = (opts?: Record<string, unknown>) => Promise<PluginHooks> | PluginHooks;

interface LoadedPlugin {
  source: string;
  hooks: PluginHooks;
}

const loadedPlugins: LoadedPlugin[] = [];
let initialised = false;

function isPluginFactory(value: unknown): value is PluginFactory {
  return typeof value === 'function';
}

/**
 * Read the `OPENAWORK_PLUGINS` env list, dynamically import each
 * path, and stash the resulting hook objects. Idempotent — safe to
 * call from multiple module init paths (the test runner, the
 * gateway boot script, hot-reload drivers, ...).
 *
 * Each plugin path can be:
 *   - An absolute filesystem path (`/srv/openawork/plugins/x.js`).
 *   - A relative path (resolved against `process.cwd()`).
 *   - A node-style package specifier (`@scope/plugin`).
 *
 * Failures (file not found, factory threw, hook shape invalid)
 * log a warning but DO NOT block boot — gateway availability
 * always wins over plugin completeness.
 */
export async function ensurePluginsLoaded(): Promise<void> {
  if (initialised) return;
  initialised = true;

  const raw = globalThis.process?.env?.['OPENAWORK_PLUGINS'];
  if (!raw) return;

  const paths = raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  for (const spec of paths) {
    try {
      // Resolve `./relative` paths against cwd. Bare module
      // specifiers and absolute paths pass through untouched.
      const importTarget =
        spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/')
          ? pathToFileURL(resolvePath(spec)).href
          : spec;
      const mod = (await import(importTarget)) as { default?: unknown };
      const factory = mod.default;
      if (!isPluginFactory(factory)) {
        console.warn(`[plugin-host] Plugin at "${spec}" has no default export factory — skipping.`);
        continue;
      }
      const hooks = await factory();
      if (hooks && typeof hooks === 'object') {
        loadedPlugins.push({ source: spec, hooks });
      }
    } catch (err) {
      console.warn(
        `[plugin-host] Failed to load plugin "${spec}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

/**
 * Run a hook against every loaded plugin in registration order.
 * Each plugin sees the SAME `output` reference, so mutations
 * compose. Hook errors are caught per-plugin so a misbehaving
 * plugin can't poison a downstream one.
 */
async function dispatchHook<K extends keyof PluginHooks>(
  hookName: K,
  input: Parameters<NonNullable<PluginHooks[K]>>[0],
  output: Parameters<NonNullable<PluginHooks[K]>>[1],
): Promise<void> {
  for (const plugin of loadedPlugins) {
    const fn = plugin.hooks[hookName] as
      | ((i: typeof input, o: typeof output) => void | Promise<void>)
      | undefined;
    if (!fn) continue;
    try {
      await fn(input, output);
    } catch (err) {
      console.warn(
        `[plugin-host] Plugin "${plugin.source}" hook "${String(hookName)}" threw: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

export async function dispatchToolExecuteBefore(
  input: ToolExecuteBeforeInput,
  output: ToolExecuteBeforeOutput,
): Promise<void> {
  await dispatchHook('tool.execute.before', input, output);
}

export async function dispatchToolExecuteAfter(
  input: ToolExecuteAfterInput,
  output: ToolExecuteAfterOutput,
): Promise<void> {
  await dispatchHook('tool.execute.after', input, output);
}

export async function dispatchChatMessage(
  input: ChatMessageInput,
  output: ChatMessageOutput,
): Promise<void> {
  await dispatchHook('chat.message', input, output);
}

export async function dispatchChatParams(
  input: ChatParamsInput,
  output: ChatParamsOutput,
): Promise<void> {
  await dispatchHook('chat.params', input, output);
}

// -----------------------------------------------------------------
// Test-only helpers — exported so unit tests can register synthetic
// plugins and reset state without round-tripping through the env
// variable + dynamic import dance. Production code MUST NOT call
// these from outside `__tests__`.
// -----------------------------------------------------------------

/** @internal Test only — register a synthetic plugin in-process. */
export function _registerPluginForTest(source: string, hooks: PluginHooks): void {
  loadedPlugins.push({ source, hooks });
}

/** @internal Test only — clear all loaded plugins (and reset init flag). */
export function _resetPluginsForTest(): void {
  loadedPlugins.length = 0;
  initialised = false;
}
