import { z } from 'zod';
import {
  OmoManifestError,
  duplicateOmoManifestIdError,
  zodToOmoManifestError,
} from './omo-adapter-errors.js';

export type OmoNativeMcpServerId =
  'codegraph' | 'git_bash' | 'lsp' | 'grep_app' | 'open_websearch' | 'websearch';

type OmoNativeMcpServerAlias = {
  readonly kind: 'native-alias';
  readonly sourceId: string;
  readonly nativeServerId: OmoNativeMcpServerId;
  readonly required: boolean;
};

type OmoRemoteMcpServerCandidate = {
  readonly kind: 'remote-candidate';
  readonly sourceId: string;
  readonly url: string;
  readonly required: boolean;
};

type OmoStdioMcpServerCandidate = {
  readonly kind: 'stdio-candidate';
  readonly sourceId: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly required: boolean;
};

type OmoNativeToolCapability = {
  readonly kind: 'native-alias';
  readonly sourceId: string;
  readonly nativeServerId: OmoNativeMcpServerId;
};

type OmoAdapterToolCapability = { readonly kind: 'adapter-candidate'; readonly sourceId: string };

export type OmoMcpServer =
  OmoNativeMcpServerAlias | OmoRemoteMcpServerCandidate | OmoStdioMcpServerCandidate;
export type OmoToolCapability = OmoNativeToolCapability | OmoAdapterToolCapability;

export type OmoMcpServersManifest = { readonly servers: readonly OmoMcpServer[] };
export type OmoToolCapabilityManifest = { readonly capabilities: readonly OmoToolCapability[] };

export type OmoMcpServersParseResult =
  | { readonly ok: true; readonly value: OmoMcpServersManifest }
  | { readonly ok: false; readonly error: OmoManifestError };

export type OmoToolCapabilityParseResult =
  | { readonly ok: true; readonly value: OmoToolCapabilityManifest }
  | { readonly ok: false; readonly error: OmoManifestError };

type OmoMcpServerConvertResult =
  | { readonly ok: true; readonly value: OmoMcpServer }
  | { readonly ok: false; readonly error: OmoManifestError };

const sourceIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9_-]+$/);

const mcpServerEntrySchema = z
  .object({
    url: z.string().trim().url().max(2000).optional(),
    command: z.string().trim().min(1).max(500).optional(),
    args: z.array(z.string().max(500)).max(100).optional(),
    cwd: z.string().trim().min(1).max(1000).optional(),
    required: z.boolean().optional(),
    transport: z.enum(['sse', 'stdio']).optional(),
    type: z.enum(['sse', 'stdio']).optional(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    const transport = entry.transport ?? entry.type;
    if (transport === 'sse' && !entry.url) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['url'], message: 'SSE MCP requires url' });
    }
    if (transport === 'stdio' && !entry.command) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['command'],
        message: 'stdio MCP requires command',
      });
    }
    if (!transport && !entry.url && !entry.command) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: 'MCP server requires url or command',
      });
    }
  });

const mcpServersManifestSchema = z
  .object({ mcpServers: z.record(sourceIdSchema, mcpServerEntrySchema) })
  .strict();

const capabilitySchema = z.string().trim().min(1).max(120);

const capabilityManifestSchema = z.union([
  z.object({ capabilities: z.array(capabilitySchema).max(200) }).strict(),
  z
    .object({
      interface: z.object({ capabilities: z.array(capabilitySchema).max(200) }).strict(),
    })
    .strict(),
]);

type OmoRawMcpServerEntry = z.infer<typeof mcpServerEntrySchema>;
type OmoCapabilityInput = z.infer<typeof capabilityManifestSchema>;

export function parseOmoMcpServersManifest(
  input: unknown,
  sourcePath?: string,
): OmoMcpServersParseResult {
  const parsed = mcpServersManifestSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: zodToOmoManifestError(parsed.error, { sourcePath }) };

  const duplicateError = findDuplicateId(
    Object.keys(parsed.data.mcpServers),
    ['mcpServers'],
    sourcePath,
  );
  if (duplicateError) return { ok: false, error: duplicateError };

  const servers: OmoMcpServer[] = [];
  for (const [sourceId, entry] of Object.entries(parsed.data.mcpServers)) {
    const converted = toMcpServer(sourceId, entry, sourcePath);
    if (!converted.ok) return converted;
    servers.push(converted.value);
  }
  return { ok: true, value: { servers } };
}

export function parseOmoToolCapabilityManifest(
  input: unknown,
  sourcePath?: string,
): OmoToolCapabilityParseResult {
  const parsed = capabilityManifestSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: zodToOmoManifestError(parsed.error, { sourcePath }) };

  const capabilities = readCapabilityIds(parsed.data);
  const duplicateError = findDuplicateId(capabilities, ['capabilities'], sourcePath);
  if (duplicateError) return { ok: false, error: duplicateError };

  return { ok: true, value: { capabilities: capabilities.map(toToolCapability) } };
}

export function toToolCapability(sourceId: string): OmoToolCapability {
  const nativeServerId = toNativeServerId(sourceId);
  if (nativeServerId) return { kind: 'native-alias', sourceId, nativeServerId };
  return { kind: 'adapter-candidate', sourceId };
}

export function canonicalizeOmoToolName(sourceId: string): string | null {
  const normalized = sourceId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized.length > 0 ? normalized : null;
}

export function toNativeServerId(sourceId: string): OmoNativeMcpServerId | null {
  switch (canonicalizeOmoToolName(sourceId)) {
    case 'codegraph':
      return 'codegraph';
    case 'git_bash':
      return 'git_bash';
    case 'lsp':
      return 'lsp';
    case 'grep_app':
      return 'grep_app';
    case 'open_websearch':
      return 'open_websearch';
    case 'websearch':
      return 'websearch';
    default:
      return null;
  }
}

export function findDuplicateId(
  ids: readonly string[],
  pathPrefix: readonly (string | number)[],
  sourcePath: string | undefined,
): OmoManifestError | null {
  const seen = new Set<string>();
  for (const id of ids) {
    const normalized = normalizeId(id);
    if (seen.has(normalized))
      return duplicateOmoManifestIdError({ id, path: pathPrefix, sourcePath });
    seen.add(normalized);
  }
  return null;
}

function toMcpServer(
  sourceId: string,
  entry: OmoRawMcpServerEntry,
  sourcePath: string | undefined,
): OmoMcpServerConvertResult {
  const nativeServerId = toNativeServerId(sourceId);
  if (nativeServerId) {
    return {
      ok: true,
      value: { kind: 'native-alias', sourceId, nativeServerId, required: entry.required ?? false },
    };
  }
  if (entry.url) {
    return {
      ok: true,
      value: {
        kind: 'remote-candidate',
        sourceId,
        url: entry.url,
        required: entry.required ?? false,
      },
    };
  }
  if (entry.command) {
    return {
      ok: true,
      value: {
        kind: 'stdio-candidate',
        sourceId,
        command: entry.command,
        args: entry.args ?? [],
        ...(entry.cwd ? { cwd: entry.cwd } : {}),
        required: entry.required ?? false,
      },
    };
  }
  return {
    ok: false,
    error: new OmoManifestError({
      code: 'invalid_schema',
      issues: [{ path: ['mcpServers', sourceId], message: 'MCP server requires url or command' }],
      sourcePath,
    }),
  };
}

function readCapabilityIds(input: OmoCapabilityInput): readonly string[] {
  if ('capabilities' in input) return input.capabilities;
  return input.interface.capabilities;
}

function normalizeId(id: string): string {
  return canonicalizeOmoToolName(id) ?? id.trim().toLowerCase();
}
