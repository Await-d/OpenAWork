import { z } from 'zod';
import { zodToOmoManifestError, type OmoManifestError } from './omo-adapter-errors.js';
import { findDuplicateId, toToolCapability, type OmoToolCapability } from './omo-tool-manifest.js';

export type OmoAdapterManifest = {
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly hookManifestPaths: readonly string[];
  readonly mcpManifestPath?: string;
  readonly skillDirectory?: string;
  readonly capabilities: readonly OmoToolCapability[];
  readonly defaultPrompt: readonly string[];
};

export type OmoAdapterManifestParseResult =
  | { readonly ok: true; readonly value: OmoAdapterManifest }
  | { readonly ok: false; readonly error: OmoManifestError };

const adapterCapabilitySchema = z.string().trim().min(1).max(120);

const adapterInterfaceSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    shortDescription: z.string().max(500).optional(),
    longDescription: z.string().max(4000).optional(),
    developerName: z.string().max(200).optional(),
    category: z.string().max(120).optional(),
    capabilities: z.array(adapterCapabilitySchema).max(200).optional(),
    websiteURL: z.string().trim().url().max(2000).optional(),
    privacyPolicyURL: z.string().trim().url().max(2000).optional(),
    termsOfServiceURL: z.string().trim().url().max(2000).optional(),
    defaultPrompt: z.array(z.string().max(1000)).max(50).optional(),
    brandColor: z.string().trim().min(1).max(40).optional(),
    screenshots: z.array(z.string().max(2000)).max(50).optional(),
  })
  .strict();

const adapterManifestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    version: z.string().trim().min(1).max(80),
    description: z.string().max(1000).optional(),
    author: z
      .object({
        name: z.string().max(200).optional(),
        email: z.string().email().max(320).optional(),
        url: z.string().url().max(2000).optional(),
      })
      .strict()
      .optional(),
    homepage: z.string().url().max(2000).optional(),
    repository: z.string().max(2000).optional(),
    license: z.string().max(120).optional(),
    keywords: z.array(z.string().max(120)).max(100).optional(),
    skills: z.string().trim().min(1).max(1000).optional(),
    hooks: z.array(z.string().trim().min(1).max(1000)).max(500).optional(),
    mcpServers: z.string().trim().min(1).max(1000).optional(),
    interface: adapterInterfaceSchema.optional(),
  })
  .strict();

export function parseOmoAdapterManifest(
  input: unknown,
  sourcePath?: string,
): OmoAdapterManifestParseResult {
  const parsed = adapterManifestSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: zodToOmoManifestError(parsed.error, { sourcePath }) };

  const capabilities = parsed.data.interface?.capabilities ?? [];
  const duplicateError = findDuplicateId(capabilities, ['interface', 'capabilities'], sourcePath);
  if (duplicateError) return { ok: false, error: duplicateError };

  return {
    ok: true,
    value: {
      name: parsed.data.name,
      version: parsed.data.version,
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      hookManifestPaths: parsed.data.hooks ?? [],
      ...(parsed.data.mcpServers !== undefined ? { mcpManifestPath: parsed.data.mcpServers } : {}),
      ...(parsed.data.skills !== undefined ? { skillDirectory: parsed.data.skills } : {}),
      capabilities: capabilities.map(toToolCapability),
      defaultPrompt: parsed.data.interface?.defaultPrompt ?? [],
    },
  };
}

export {
  OMO_MANIFEST_ERROR_CODES,
  OmoManifestError,
  duplicateOmoManifestIdError,
  zodToOmoManifestError,
  type OmoManifestErrorCode,
  type OmoManifestIssue,
} from './omo-adapter-errors.js';

export {
  parseOmoHookManifest,
  type OmoCommandHook,
  type OmoHookEvent,
  type OmoHookManifest,
  type OmoHookManifestParseResult,
  type OmoHookRegistration,
} from './omo-hook-manifest.js';

export {
  canonicalizeOmoToolName,
  findDuplicateId,
  parseOmoMcpServersManifest,
  parseOmoToolCapabilityManifest,
  toNativeServerId,
  toToolCapability,
  type OmoMcpServer,
  type OmoMcpServersManifest,
  type OmoMcpServersParseResult,
  type OmoNativeMcpServerId,
  type OmoToolCapability,
  type OmoToolCapabilityManifest,
  type OmoToolCapabilityParseResult,
} from './omo-tool-manifest.js';
