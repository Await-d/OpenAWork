import { z } from 'zod';
import type { ChannelInstance, ChannelPermissions } from './types.js';

export const CHANNEL_MEMBER_ACL_CONFIG_KEY = 'memberAclJson';

const channelMemberPermissionPatchSchema = z
  .object({
    allowReadHome: z.boolean().optional(),
    readablePathPrefixes: z.array(z.string().trim().min(1)).optional(),
    allowWriteOutside: z.boolean().optional(),
    allowShell: z.boolean().optional(),
    allowSubAgents: z.boolean().optional(),
  })
  .strict();

const channelMemberAclRuleSchema = z
  .object({
    platformUserId: z.string().trim().min(1),
    senderName: z.string().trim().min(1).optional(),
    workspaceId: z.string().trim().min(1).optional(),
    userId: z.string().trim().min(1).optional(),
    toolAllowlist: z.array(z.string().trim().min(1)).nullable().optional(),
    permissions: channelMemberPermissionPatchSchema.optional(),
  })
  .strict();

const channelMemberAclDocumentSchema = z.union([
  z.array(channelMemberAclRuleSchema),
  z
    .object({
      version: z.literal(1).optional(),
      rules: z.array(channelMemberAclRuleSchema),
    })
    .strict(),
]);

type ChannelMemberAclRule = z.infer<typeof channelMemberAclRuleSchema>;

export interface ChannelMemberAclActor {
  readonly aclConfigured: boolean;
  readonly matched: boolean;
  readonly permissions: ChannelPermissions;
  readonly platformUserId: string;
  readonly senderName: string;
  readonly toolAllowlist: readonly string[] | null;
  readonly userId?: string;
  readonly workspaceId?: string;
}

export interface ResolvedChannelMemberAcl {
  readonly actor: ChannelMemberAclActor;
  readonly effectiveChannel: ChannelInstance;
}

const DEFAULT_MEMBER_PERMISSIONS = {
  allowReadHome: false,
  readablePathPrefixes: [],
  allowWriteOutside: false,
  allowShell: false,
  allowSubAgents: false,
} as const satisfies ChannelPermissions;

function dedupeStringList(values: readonly string[]): readonly string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
  );
}

function normalizeToolAllowlist(
  toolAllowlist: ChannelMemberAclRule['toolAllowlist'],
): readonly string[] | null {
  if (toolAllowlist === null) {
    return null;
  }
  if (toolAllowlist === undefined) {
    return null;
  }
  return dedupeStringList(toolAllowlist);
}

function buildEffectivePermissions(
  basePermissions: ChannelPermissions | undefined,
  overridePermissions: ChannelMemberAclRule['permissions'] | undefined,
  fallbackPermissions: ChannelPermissions,
): ChannelPermissions {
  const inheritedPermissions = {
    ...DEFAULT_MEMBER_PERMISSIONS,
    ...(basePermissions ?? {}),
  };
  const memberPermissions = overridePermissions
    ? {
        allowReadHome: overridePermissions.allowReadHome ?? inheritedPermissions.allowReadHome,
        readablePathPrefixes:
          overridePermissions.readablePathPrefixes ?? inheritedPermissions.readablePathPrefixes,
        allowWriteOutside:
          overridePermissions.allowWriteOutside ?? inheritedPermissions.allowWriteOutside,
        allowShell: overridePermissions.allowShell ?? inheritedPermissions.allowShell,
        allowSubAgents: overridePermissions.allowSubAgents ?? inheritedPermissions.allowSubAgents,
      }
    : inheritedPermissions;

  return {
    allowReadHome: fallbackPermissions.allowReadHome && memberPermissions.allowReadHome,
    readablePathPrefixes: fallbackPermissions.readablePathPrefixes.filter((prefix) =>
      memberPermissions.readablePathPrefixes.includes(prefix),
    ),
    allowWriteOutside: fallbackPermissions.allowWriteOutside && memberPermissions.allowWriteOutside,
    allowShell: fallbackPermissions.allowShell && memberPermissions.allowShell,
    allowSubAgents: fallbackPermissions.allowSubAgents && memberPermissions.allowSubAgents,
  };
}

function parseChannelMemberAclRules(channel: ChannelInstance): readonly ChannelMemberAclRule[] {
  const rawValue = channel.config[CHANNEL_MEMBER_ACL_CONFIG_KEY]?.trim();
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = channelMemberAclDocumentSchema.parse(JSON.parse(rawValue) as unknown);
    return Array.isArray(parsed) ? parsed : parsed.rules;
  } catch (error) {
    console.warn('[channels] member ACL JSON parse failed, ignore runtime ACL override', {
      channelId: channel.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export function resolveChannelMemberAcl(
  channel: ChannelInstance,
  actor: { readonly platformUserId: string; readonly senderName: string },
): ResolvedChannelMemberAcl {
  const configuredRules = parseChannelMemberAclRules(channel);
  const matchedRule =
    configuredRules.find((rule) => rule.platformUserId === actor.platformUserId) ?? null;
  const aclConfigured = configuredRules.length > 0;
  const inheritedPermissions = {
    ...DEFAULT_MEMBER_PERMISSIONS,
    ...(channel.permissions ?? {}),
  };
  const fallbackPermissions =
    matchedRule || !aclConfigured ? inheritedPermissions : DEFAULT_MEMBER_PERMISSIONS;
  const effectivePermissions = buildEffectivePermissions(
    channel.permissions,
    matchedRule?.permissions,
    fallbackPermissions,
  );
  const toolAllowlist = aclConfigured
    ? matchedRule
      ? normalizeToolAllowlist(matchedRule.toolAllowlist)
      : []
    : null;

  return {
    actor: {
      aclConfigured,
      matched: matchedRule !== null,
      permissions: effectivePermissions,
      platformUserId: actor.platformUserId,
      senderName: actor.senderName,
      toolAllowlist,
      ...(matchedRule?.workspaceId ? { workspaceId: matchedRule.workspaceId } : {}),
      ...(matchedRule?.userId ? { userId: matchedRule.userId } : {}),
    },
    effectiveChannel: {
      ...channel,
      permissions: effectivePermissions,
    },
  };
}
