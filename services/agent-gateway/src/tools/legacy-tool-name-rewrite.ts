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
 * NOTE: The mirror map `LEGACY_TOOL_NAME_TO_CANONICAL` deliberately repeats
 * the entries used by `routes/tool-name-compat.ts`. Centralising it here
 * keeps the sandbox import graph from reaching into `routes/`, which would
 * invert the layering.
 */

const LEGACY_TOOL_NAME_TO_CANONICAL: Readonly<Record<string, string>> = {
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
 * Rewrite a legacy tool request (name + raw input) to its canonical form.
 * Returns the original request untouched when `toolName` is not a legacy
 * alias.
 */
export function rewriteLegacyToolRequest(toolName: string, rawInput: unknown): LegacyRewriteResult {
  const canonical = LEGACY_TOOL_NAME_TO_CANONICAL[toolName];
  if (!canonical) {
    return { toolName, rawInput, rewritten: false };
  }

  if (toolName === 'workspace_search' && isPlainObject(rawInput)) {
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
