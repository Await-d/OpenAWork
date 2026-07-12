import type { MCPToolDef, MCPToolResult } from '@openAwork/mcp-client';
import {
  canonicalizeOmoToolName,
  parseOmoMcpServersManifest,
  parseOmoToolCapabilityManifest,
  type OmoManifestError,
  type OmoMcpServer,
  type OmoToolCapability,
} from '../omo/index.js';
import type { MCPCallInput } from './mcp-runtime.js';

export interface OmoVirtualCatalogSource {
  readonly mcpServersManifest: unknown;
  readonly toolCapabilityManifest: unknown;
}

export interface OmoVirtualCatalogDiagnostic {
  readonly source: 'mcpServers' | 'capabilities';
  readonly code: string;
  readonly message: string;
}

export interface OmoVirtualCatalogEntry {
  readonly sourceId: string;
  readonly toolName: string;
  readonly kind: 'remote-candidate' | 'stdio-candidate' | 'adapter-candidate';
  readonly nativeAlias: false;
}

export interface OmoVirtualCatalog {
  readonly entries: readonly OmoVirtualCatalogEntry[];
  readonly diagnostics: readonly OmoVirtualCatalogDiagnostic[];
  readonly nativeAliases: readonly string[];
}

const DEFAULT_OMO_CATALOG_SOURCE = {
  toolCapabilityManifest: {
    capabilities: [
      'codegraph',
      'git_bash',
      'lsp',
      'grep_app',
      'open_websearch',
      'context7',
      'ast-grep',
    ],
  },
  mcpServersManifest: {
    mcpServers: {
      codegraph: { command: 'openawork-virtual-codegraph' },
      git_bash: { command: 'openawork-virtual-git-bash' },
      lsp: { command: 'openawork-virtual-lsp' },
      grep_app: { url: 'https://mcp.grep.app' },
      open_websearch: { command: 'openawork-virtual-open-websearch' },
      context7: { url: 'https://mcp.context7.com/mcp' },
    },
  },
} as const satisfies OmoVirtualCatalogSource;

const ADAPTER_CATALOG_TOOL = {
  name: 'adapter_catalog',
  description: '列出 OpenAWork OMO adapter 已识别的原生 alias、候选 MCP 与诊断信息。',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
} satisfies MCPToolDef;

export function listOmoVirtualMcpTools(): MCPToolDef[] {
  return buildOmoVirtualMcpTools(DEFAULT_OMO_CATALOG_SOURCE);
}

export function buildOmoVirtualMcpTools(
  source: OmoVirtualCatalogSource = DEFAULT_OMO_CATALOG_SOURCE,
): MCPToolDef[] {
  const catalog = buildOmoVirtualCatalog(source);
  const tools = [ADAPTER_CATALOG_TOOL];
  for (const entry of catalog.entries) {
    tools.push({
      name: entry.toolName,
      description: `OMO adapter candidate for ${entry.sourceId}. It reports catalog metadata only and does not execute commands.`,
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    });
  }
  return tools;
}

export async function callOmoVirtualMcp(
  _sessionId: string,
  input: MCPCallInput,
): Promise<MCPToolResult> {
  const catalog = buildOmoVirtualCatalog(DEFAULT_OMO_CATALOG_SOURCE);
  if (input.toolName === ADAPTER_CATALOG_TOOL.name) {
    return catalogResult(catalog);
  }

  const entry = catalog.entries.find((candidate) => candidate.toolName === input.toolName);
  if (!entry) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Unknown OMO adapter catalog tool: ${input.toolName}` }],
      structuredContent: { toolName: input.toolName, knownTools: catalog.entries.map(toToolName) },
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: `OMO candidate ${entry.sourceId} is cataloged but not executable by the T3 virtual MCP adapter.`,
      },
    ],
    structuredContent: { entry, executable: false },
  };
}

export function buildOmoVirtualCatalog(source: OmoVirtualCatalogSource): OmoVirtualCatalog {
  const diagnostics: OmoVirtualCatalogDiagnostic[] = [];
  const nativeAliases = new Set<string>();
  const entriesByToolName = new Map<string, OmoVirtualCatalogEntry>();

  const mcpResult = parseOmoMcpServersManifest(source.mcpServersManifest);
  if (mcpResult.ok) {
    for (const server of mcpResult.value.servers) {
      const entry = catalogEntryFromMcpServer(server);
      if (entry) {
        addCatalogEntry(entriesByToolName, diagnostics, 'mcpServers', entry);
      } else {
        nativeAliases.add(server.sourceId);
      }
    }
  } else {
    diagnostics.push(diagnosticFromError('mcpServers', mcpResult.error));
  }

  const capabilityResult = parseOmoToolCapabilityManifest(source.toolCapabilityManifest);
  if (capabilityResult.ok) {
    for (const capability of capabilityResult.value.capabilities) {
      const entry = catalogEntryFromCapability(capability);
      if (entry) {
        addCatalogEntry(entriesByToolName, diagnostics, 'capabilities', entry);
      } else {
        nativeAliases.add(capability.sourceId);
      }
    }
  } else {
    diagnostics.push(diagnosticFromError('capabilities', capabilityResult.error));
  }

  return {
    entries: [...entriesByToolName.values()].sort((left, right) =>
      left.toolName.localeCompare(right.toolName),
    ),
    diagnostics,
    nativeAliases: [...nativeAliases].sort((left, right) => left.localeCompare(right)),
  };
}

function addCatalogEntry(
  entriesByToolName: Map<string, OmoVirtualCatalogEntry>,
  diagnostics: OmoVirtualCatalogDiagnostic[],
  source: OmoVirtualCatalogDiagnostic['source'],
  entry: OmoVirtualCatalogEntry,
): void {
  const existing = entriesByToolName.get(entry.toolName);
  if (!existing) {
    entriesByToolName.set(entry.toolName, entry);
    return;
  }
  if (existing.sourceId === entry.sourceId) {
    return;
  }
  diagnostics.push({
    source,
    code: 'duplicate_id',
    message: `Duplicate OMO manifest id: ${entry.sourceId} collides with ${existing.sourceId} after tool-name normalization.`,
  });
}

function catalogEntryFromMcpServer(server: OmoMcpServer): OmoVirtualCatalogEntry | null {
  switch (server.kind) {
    case 'native-alias':
      return null;
    case 'remote-candidate':
      return catalogEntry(server.sourceId, 'remote-candidate');
    case 'stdio-candidate':
      return catalogEntry(server.sourceId, 'stdio-candidate');
  }
}

function catalogEntryFromCapability(capability: OmoToolCapability): OmoVirtualCatalogEntry | null {
  switch (capability.kind) {
    case 'native-alias':
      return null;
    case 'adapter-candidate':
      return catalogEntry(capability.sourceId, 'adapter-candidate');
  }
}

function catalogEntry(
  sourceId: string,
  kind: OmoVirtualCatalogEntry['kind'],
): OmoVirtualCatalogEntry | null {
  const toolName = canonicalizeOmoToolName(sourceId);
  if (!toolName) return null;
  return { sourceId, toolName, kind, nativeAlias: false };
}

function catalogResult(catalog: OmoVirtualCatalog): MCPToolResult {
  return {
    content: [
      {
        type: 'text',
        text: `OMO adapter catalog: ${catalog.entries.length} candidate tools, ${catalog.nativeAliases.length} native aliases, ${catalog.diagnostics.length} diagnostics.`,
      },
    ],
    structuredContent: catalog,
  };
}

function diagnosticFromError(
  source: OmoVirtualCatalogDiagnostic['source'],
  error: OmoManifestError,
): OmoVirtualCatalogDiagnostic {
  return {
    source,
    code: error.code,
    message: error.message,
  };
}

function toToolName(entry: OmoVirtualCatalogEntry): string {
  return entry.toolName;
}
