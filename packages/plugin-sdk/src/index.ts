/**
 * `@openAwork/plugin-sdk` — plugin authoring surface.
 *
 * The package root is the Promise entrypoint (mirrors opencode v2, whose
 * default export is the Promise API). The Effect entrypoint lives at
 * `@openAwork/plugin-sdk/effect`.
 *
 * Types-only exports live here so plugin authors can import the event
 * payloads they mutate without pulling the Effect subpath.
 */

export { define } from './promise.js';
export type { PromisePlugin } from './promise.js';
export type { EffectPlugin } from './effect.js';

export type { AppInfo, Cleanup, Disposable, PluginInfo, PluginOptions } from './types.js';

export type {
  HookCallback,
  PermissionEvaluateEvent,
  PluginHookEvents,
  PluginHookName,
  SessionContextEvent,
  SessionPromptEvent,
  ToolExecuteAfterEvent,
  ToolExecuteBeforeEvent,
} from './hooks.js';

export type {
  EventDomain,
  EventSubscribeOptions,
  PermissionDomain,
  PermissionHookName,
  PluginContext,
  PluginDomain,
  PluginEvent,
  PluginToolDefinition,
  PluginToolExecutionContext,
  PluginToolInfo,
  PluginToolInputSchema,
  PluginToolResult,
  SessionDomain,
  SessionHookName,
  StorageDomain,
  StorageEntry,
  StorageScanOptions,
  StorageScanResult,
  ToolDomain,
  ToolEditor,
  ToolHookName,
} from './domains.js';
