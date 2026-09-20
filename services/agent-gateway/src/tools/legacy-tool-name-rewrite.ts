/**
 * Legacy tool-name rewrite
 *
 * Historical clients (and a small number of stored sessions) still emit the
 * `workspace_*` names that predate our canonical short names (`list / read /
 * grep / write`). The canonical tools are the only ones registered in the
 * sandbox now, so any incoming legacy name has to be rewritten to its
 * canonical equivalent before dispatch.
 *
 * Field-level remapping is only required for `workspace_search → grep`, where
 * the old `query` parameter has to become `pattern`. All other legacy names
 * already share their canonical sibling's input schema (path/filePath aliases
 * are accepted by `read` / `write`), so the input object can be passed
 * through unchanged.
 *
 * Legacy OpenAI function-calling payloads additionally namespace every tool
 * name as `functions.<name>` (e.g. `functions.execute_shell`,
 * `functions.Agent`). A single leading `functions.` prefix is stripped before
 * the legacy lookup so those requests resolve to the same canonical names as
 * their bare counterparts; the stripped name is returned even when it is not
 * a legacy alias, letting downstream dispatch handle the rest.
 *
 * NOTE: The mirror map `LEGACY_TOOL_NAME_TO_CANONICAL` deliberately repeats
 * the entries used by `routes/tool-name-compat.ts`. Centralising it here
 * keeps the sandbox import graph from reaching into `routes/`, which would
 * invert the layering.
 */

const OPENAI_FUNCTIONS_PREFIX = 'functions.';

const LEGACY_TOOL_NAME_TO_CANONICAL: Readonly<Record<string, string>> = {
  execute_shell: 'bash',
  web_search: 'websearch',
  workspace_tree: 'list',
  workspace_read_file: 'read',
  workspace_search: 'grep',
  workspace_write_file: 'write',
  workspace_create_file: 'write',
};

export interface LegacyRewriteResult {
  toolName: string;
  rawInput: unknown;
  rewritten: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Remove a single leading `functions.` namespace prefix (legacy OpenAI
 * function-calling payloads). Only the very first occurrence is stripped:
 * `functions.functions.x` becomes `functions.x`, and names without the
 * prefix pass through untouched.
 */
function stripFunctionsNamespacePrefix(toolName: string): string {
  if (!toolName.startsWith(OPENAI_FUNCTIONS_PREFIX)) {
    return toolName;
  }
  return toolName.slice(OPENAI_FUNCTIONS_PREFIX.length);
}

/**
 * Rewrite a legacy tool request (name + raw input) to its canonical form.
 * A single leading `functions.` prefix is stripped first; when the stripped
 * name is not a legacy alias it is still returned so downstream dispatch can
 * resolve it (e.g. `functions.Agent` → `Agent`). Returns the original request
 * untouched when no rewriting applies.
 */
export function rewriteLegacyToolRequest(toolName: string, rawInput: unknown): LegacyRewriteResult {
  const unprefixedName = stripFunctionsNamespacePrefix(toolName);
  const canonical = LEGACY_TOOL_NAME_TO_CANONICAL[unprefixedName];
  if (!canonical) {
    if (unprefixedName === toolName) {
      return { toolName, rawInput, rewritten: false };
    }
    return { toolName: unprefixedName, rawInput, rewritten: true };
  }

  if (unprefixedName === 'workspace_search' && isPlainObject(rawInput)) {
    // Old shape: { path, query, maxResults? }
    // grep shape: { pattern, path?, include?, output_mode?, head_limit? }
    const { path, query, maxResults, ...rest } = rawInput;
    const next: Record<string, unknown> = {
      ...rest,
      ...(typeof query === 'string' ? { pattern: query } : {}),
      ...(typeof path === 'string' ? { path } : {}),
      ...(typeof maxResults === 'number' ? { head_limit: maxResults } : {}),
      // Most workspace_search callers wanted file:line:text hits, which
      // matches grep's `content` mode. Old `files_with_matches` callers
      // can pass output_mode explicitly.
      output_mode: 'content',
    };
    return { toolName: canonical, rawInput: next, rewritten: true };
  }

  return { toolName: canonical, rawInput, rewritten: true };
}

export function isLegacyToolName(toolName: string): boolean {
  return Object.prototype.hasOwnProperty.call(LEGACY_TOOL_NAME_TO_CANONICAL, toolName);
}
