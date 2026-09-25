/**
 * Domain APIs exposed on the plugin context.
 *
 * The context is grouped by domain (opencode v2 style) instead of a flat
 * hook map. This phase ships the hook domains only; storage, events,
 * tool registration and config transforms land in later phases.
 */

import type { HookCallback } from './hooks.js';
import type { AppInfo, Disposable, PluginInfo, PluginOptions } from './types.js';

/** Domain-local hook names for the `tool` domain. */
export type ToolHookName = 'execute.before' | 'execute.after';

/** Domain-local hook names for the `session` domain. */
export type SessionHookName = 'prompt' | 'context';

/** Domain-local hook names for the `permission` domain. */
export type PermissionHookName = 'evaluate';

// ─── Tool registration (transform) ───

/** JSON Schema subset accepted for plugin tool inputs (object shape). */
export interface PluginToolInputSchema {
  readonly type: 'object';
  readonly properties: Record<string, unknown>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
}

/** Context handed to a plugin tool's `execute`. */
export interface PluginToolExecutionContext {
  readonly sessionID: string;
  readonly callID: string;
  /** Aborted when the turn is cancelled. */
  readonly signal: AbortSignal;
}

export interface PluginToolResult {
  readonly output: unknown;
  readonly isError?: boolean;
}

/**
 * A tool a plugin contributes to the model-visible tool surface.
 *
 * Safety: plugin tools are NOT mapped to a built-in permission category,
 * so the permission ladder resolves them to `custom` (default `ask`) —
 * they can never be auto-approved. Names must be unique and must not
 * collide with built-in tools; collisions are rejected at registration.
 */
export interface PluginToolDefinition {
  /** `[a-zA-Z][a-zA-Z0-9_-]{0,63}`; must not collide with built-in tools. */
  readonly name: string;
  readonly description: string;
  readonly input: PluginToolInputSchema;
  execute(
    input: unknown,
    context: PluginToolExecutionContext,
  ): Promise<PluginToolResult> | PluginToolResult;
}

/** Read-only view of a registered plugin tool. */
export interface PluginToolInfo {
  readonly name: string;
  readonly description: string;
  readonly pluginId: string;
}

/**
 * Synchronous editor handed to `tool.transform`. Changes are replayed
 * onto the plugin tool registry; they take effect on the next agent
 * turn (tool definitions and the sandbox are built per turn).
 */
export interface ToolEditor {
  /** All plugin tools currently registered (from every plugin). */
  list(): readonly PluginToolInfo[];
  get(name: string): PluginToolDefinition | undefined;
  /** Register a tool; throws on invalid or colliding names. */
  add(tool: PluginToolDefinition): void;
  /** Remove a tool by name (no-op when absent). */
  remove(name: string): void;
}

export interface ToolDomain {
  /** Register a tool hook. Returns a handle that unregisters on `dispose()`. */
  hook<Name extends ToolHookName>(name: Name, callback: HookCallback<`tool.${Name}`>): Disposable;
  /**
   * Register / inspect plugin-contributed tools. The callback receives a
   * synchronous editor; changes take effect on the next agent turn.
   */
  transform(callback: (editor: ToolEditor) => void): Disposable;
}

export interface SessionDomain {
  /** Register a session hook. Returns a handle that unregisters on `dispose()`. */
  hook<Name extends SessionHookName>(
    name: Name,
    callback: HookCallback<`session.${Name}`>,
  ): Disposable;
}

export interface PermissionDomain {
  /** Register a permission hook. Returns a handle that unregisters on `dispose()`. */
  hook<Name extends PermissionHookName>(
    name: Name,
    callback: HookCallback<`permission.${Name}`>,
  ): Disposable;
}

export interface PluginDomain {
  /** Currently loaded plugins and their runtime state. */
  list(): readonly PluginInfo[];
}

/** Options for `storage.scan`. */
export interface StorageScanOptions {
  /** Only return keys starting with this prefix. */
  readonly prefix?: string;
  /** Maximum number of entries to return (default 100, max 1000). */
  readonly limit?: number;
}

export interface StorageEntry {
  readonly key: string;
  readonly value: unknown;
}

export interface StorageScanResult {
  readonly entries: readonly StorageEntry[];
}

/**
 * Per-plugin durable key/value store (JSON values).
 *
 * Storage is scoped to the plugin id and survives gateway restarts.
 * Values must be JSON-serializable; a single value is capped at 256 KiB.
 */
export interface StorageDomain {
  /** Read a value; `undefined` when the key is absent. */
  get(key: string): Promise<unknown>;
  /** Write a JSON-serializable value (insert or overwrite). */
  set(key: string, value: unknown): Promise<void>;
  /** Delete a key; no-op when absent. */
  remove(key: string): Promise<void>;
  /** List entries ordered by key, optionally filtered by prefix. */
  scan(options?: StorageScanOptions): Promise<StorageScanResult>;
}

/** A gateway event delivered to plugin subscribers. */
export interface PluginEvent {
  /** Event type, e.g. `session.created` / `message.part.updated` / `todo.updated`. */
  readonly type: string;
  readonly data: unknown;
}

export interface EventSubscribeOptions {
  /**
   * Only receive events whose type equals or starts with one of these
   * filters (e.g. `['session.', 'todo.']`). Omit to receive everything.
   */
  readonly types?: readonly string[];
  /** Stop the subscription (combined with the plugin-lifetime signal). */
  readonly signal?: AbortSignal;
}

/**
 * Gateway event stream subscription.
 *
 * The returned async iterable stops when the plugin unloads (its
 * lifetime signal aborts) or when `options.signal` aborts. Subscribers
 * that fall behind drop the oldest queued events (bounded queue).
 */
export interface EventDomain {
  subscribe(options?: EventSubscribeOptions): AsyncIterable<PluginEvent>;
}

/** The context handed to every plugin's `effect` / `setup`. */
export interface PluginContext {
  readonly app: AppInfo;
  readonly options: PluginOptions;
  readonly tool: ToolDomain;
  readonly session: SessionDomain;
  readonly permission: PermissionDomain;
  readonly storage: StorageDomain;
  readonly event: EventDomain;
  readonly plugin: PluginDomain;
}
