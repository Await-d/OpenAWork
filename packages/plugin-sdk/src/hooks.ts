/**
 * Hook event payloads.
 *
 * Hooks receive ONE mutable event object (opencode v2 style). Mutations
 * to the documented mutable fields are observed by the gateway after the
 * hook returns. The gateway never lets a hook error break the main flow:
 * every callback is isolated and failures are logged as warnings.
 */

/**
 * `tool.execute.before` — fired immediately before a tool's execution
 * function runs. Mutate `event.args` to sanitize / redact / inject
 * defaults; the mutated args are what downstream execution sees.
 */
export interface ToolExecuteBeforeEvent {
  readonly tool: string;
  readonly sessionID: string;
  readonly callID: string;
  args: unknown;
}

/**
 * `tool.execute.after` — fired once the tool returns (or throws).
 * Mutate `event.output` / `event.title` / `event.metadata`.
 */
export interface ToolExecuteAfterEvent {
  readonly tool: string;
  readonly sessionID: string;
  readonly callID: string;
  readonly args: unknown;
  title?: string;
  output: unknown;
  metadata: Record<string, unknown>;
}

/**
 * `session.prompt` — a new user message is being processed. The parts
 * array is passed by reference and treated as advisory in this MVP.
 */
export interface SessionPromptEvent {
  readonly sessionID: string;
  readonly modelId?: string;
  readonly messageID?: string;
  message: { role: string; content: unknown };
  parts: unknown[];
}

/**
 * `session.context` — fired right before the gateway dispatches the
 * model request. Mutate sampling parameters or `event.options`.
 */
export interface SessionContextEvent {
  readonly sessionID: string;
  readonly modelId: string;
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  options: Record<string, unknown>;
}

/**
 * `permission.evaluate` — deny-only post-adjudication of a tool
 * permission decision. The sandbox dispatches this hook AFTER the
 * built-in permission ladder has settled; plugins may ONLY downgrade
 * the outcome by setting `effect = 'deny'`. Every other value is
 * ignored, so the hook can never grant or widen a permission.
 */
export interface PermissionEvaluateEvent {
  readonly sessionID: string;
  readonly toolName: string;
  /** Resolved permission category, e.g. 'bash' | 'edit' | 'write' | 'mcp_call' | 'custom'. */
  readonly permission: string;
  /** Concrete resource scope of this call; '*' when decided by a tool-level wildcard. */
  readonly scope: string;
  /** Built-in verdict entering this hook: 'allow' = 放行/免审批, 'ask' = 将进入人工审批. */
  readonly decision: 'allow' | 'ask';
  /** Deny-only: plugins may set 'deny'; every other value is ignored. */
  effect?: 'deny';
  /** User-facing reason used when a `'deny'` effect is honoured. */
  message?: string;
}

/** Event payload for each hook, keyed by its fully-qualified name. */
export interface PluginHookEvents {
  'tool.execute.before': ToolExecuteBeforeEvent;
  'tool.execute.after': ToolExecuteAfterEvent;
  'session.prompt': SessionPromptEvent;
  'session.context': SessionContextEvent;
  'permission.evaluate': PermissionEvaluateEvent;
}

/** Fully-qualified hook name (domain + event), e.g. `tool.execute.before`. */
export type PluginHookName = keyof PluginHookEvents;

/** Callback registered for a hook; errors are isolated by the gateway. */
export type HookCallback<Name extends PluginHookName> = (
  event: PluginHookEvents[Name],
) => void | Promise<void>;
