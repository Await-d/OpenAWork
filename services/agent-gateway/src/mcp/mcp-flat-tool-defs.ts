/**
 * Build flattened LLM-visible tool definitions for MCP tools.
 *
 * In the legacy mode (`mcp_list_tools` + `mcp_call`), the model has to
 * make TWO tool calls to use any MCP tool: first list, then call. This
 * doubles latency for every MCP usage and — more critically — bloats
 * the prompt-cache prefix unstably (the listTools result is rendered
 * into the assistant context and changes whenever the server's tool
 * set mutates, defeating Anthropic / OpenAI cache hits).
 *
 * Flat mode (this file, PR-C) sidesteps both problems: each MCP tool
 * is exposed to the model as its own function, so a single tool call
 * suffices, and the LLM-visible surface is a stable byte-for-byte
 * snapshot until the underlying server pushes a `tools/list_changed`.
 *
 * Mirrors opencode's `mcp/index.ts:122-151` `convertMcpTool`. We keep
 * the input schema as-is from the MCP server (it's already JSON Schema
 * 7 — what `OpenAI` and `Anthropic` natively accept). Wrappers in
 * `tool-sandbox.ts` route the call back to the right adapter via
 * `parseFlatMcpToolName` + the connection pool.
 */

import type { GatewayToolDefinition } from '../tools/tool-definitions.js';
import type { MCPServerToolCatalog } from './mcp-runtime.js';
import { flatMcpToolName, isFlatMcpToolsDisabled } from './mcp-tool-naming.js';

interface JsonSchemaShape {
  type?: unknown;
  properties?: Record<string, unknown>;
  required?: unknown;
  additionalProperties?: unknown;
  [key: string]: unknown;
}

/**
 * Coerce an MCP tool's `inputSchema` into the
 * `{type:'object', properties, required, additionalProperties}` shape
 * that {@link GatewayToolDefinition} expects. MCP servers in practice
 * always return an object schema, but defensively normalise so a
 * misbehaving server can't break the gateway-tool registration.
 */
function normaliseInputSchema(raw: unknown): GatewayToolDefinition['function']['parameters'] {
  const schema =
    typeof raw === 'object' && raw !== null ? (raw as JsonSchemaShape) : ({} as JsonSchemaShape);

  const properties =
    schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((value): value is string => typeof value === 'string')
    : [];
  const additionalProperties =
    typeof schema.additionalProperties === 'boolean' ? schema.additionalProperties : false;

  return {
    type: 'object',
    properties,
    required,
    additionalProperties,
  };
}

export interface BuildFlatMcpToolDefinitionsResult {
  /** LLM-visible tool definitions in flattened form. */
  definitions: GatewayToolDefinition[];
  /**
   * Map of `flatToolName → { serverId, toolName }`. Returned alongside
   * the definitions so `tool-sandbox.ts` can route incoming calls
   * without re-running `parseFlatMcpToolName` (and to handle the rare
   * case where two distinct (server, tool) pairs sanitise to the same
   * flat name — see PR-C.1 collision handling).
   */
  routeMap: Map<string, { serverId: string; toolName: string }>;
}

/**
 * Convert a {@link MCPServerToolCatalog} list (one entry per
 * configured MCP server, returned by `listMcpToolsForSession`) into
 * the flattened LLM tool definitions.
 *
 * Behaviour:
 *   - Servers with `status !== 'connected'` are skipped — we don't
 *     want to advertise tools the LLM can't actually call.
 *   - When `OPENAWORK_DISABLE_MCP_FLAT_TOOLS=1` the function returns
 *     empty arrays so the legacy `mcp_list_tools` + `mcp_call`
 *     wrappers remain the only LLM-visible MCP surface.
 *   - Tools from servers in `disabledTools` are already filtered out
 *     by `MCPClientAdapterImpl.listTools`, so we don't re-check here.
 *   - Collisions in the sanitised flat name are resolved by keeping
 *     the FIRST occurrence in the catalog order; later ones are
 *     dropped and noted in `console.warn` so operators can rename.
 */
export function buildFlatMcpToolDefinitions(
  catalogs: MCPServerToolCatalog[],
): BuildFlatMcpToolDefinitionsResult {
  if (isFlatMcpToolsDisabled()) {
    return { definitions: [], routeMap: new Map() };
  }

  const definitions: GatewayToolDefinition[] = [];
  const routeMap = new Map<string, { serverId: string; toolName: string }>();

  for (const catalog of catalogs) {
    if (catalog.status !== 'connected') continue;

    for (const tool of catalog.tools) {
      const flatName = flatMcpToolName(catalog.serverId, tool.name);
      if (routeMap.has(flatName)) {
        // Collision — the first registration wins. In practice this
        // should be vanishingly rare given the sanitiser + hash-truncation
        // strategy in `mcp-tool-naming.ts`, but operators can rename
        // their server to dodge it if it ever bites them.
        console.warn(
          `[mcp-flat-tool-defs] Duplicate flat name ${flatName} from server=${catalog.serverId} tool=${tool.name}; keeping first registration.`,
        );
        continue;
      }

      definitions.push({
        type: 'function',
        function: {
          name: flatName,
          // Prefix the server name into the description so the model
          // has unambiguous context when picking between similarly
          // named tools across servers (e.g. github.search vs
          // gitea.search).
          description: `[mcp:${catalog.serverName}] ${tool.description ?? ''}`.trim(),
          parameters: normaliseInputSchema(tool.inputSchema),
          strict: false,
        },
      });
      routeMap.set(flatName, { serverId: catalog.serverId, toolName: tool.name });
    }
  }

  return { definitions, routeMap };
}
