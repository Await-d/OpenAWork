import { z } from 'zod';
import type {
  ChannelFeatures,
  ChannelInstance,
  ChannelPermissions,
  ChannelSubscription,
} from './channels/types.js';
import { SUPPORTED_CHANNEL_PLATFORMS } from './channels/types.js';

const channelFeaturesSchema = z.object({
  autoReply: z.boolean().default(false),
  streamingReply: z.boolean().default(false),
  autoStart: z.boolean().default(false),
});

const channelPermissionsSchema = z.object({
  allowReadHome: z.boolean().default(false),
  readablePathPrefixes: z.array(z.string()).default([]),
  allowWriteOutside: z.boolean().default(false),
  allowShell: z.boolean().default(false),
  allowSubAgents: z.boolean().default(false),
});

export const channelSubscriptionSchema = z.object({
  chatId: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
});

const channelBaseSchema = z.object({
  type: z.enum(SUPPORTED_CHANNEL_PLATFORMS),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  config: z.record(z.string(), z.string()).default({}),
  tools: z.record(z.string(), z.boolean()).optional(),
  providerId: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  features: channelFeaturesSchema.optional(),
  permissions: channelPermissionsSchema.optional(),
  subscriptions: z.array(channelSubscriptionSchema).optional(),
});

export const channelCreateSchema = channelBaseSchema.extend({
  id: z.string().min(1).optional(),
});

export const channelUpdateSchema = channelBaseSchema;

const storedChannelSchema = channelBaseSchema.extend({
  id: z.string().min(1),
  createdAt: z.number().int().nonnegative().optional(),
  updatedAt: z.number().int().nonnegative().optional(),
  ownerUserId: z.string().optional(),
});

type ChannelCreateInput = z.infer<typeof channelCreateSchema>;
type StoredChannelInput = z.infer<typeof storedChannelSchema>;

const defaultFeatures = (): ChannelFeatures => ({
  autoReply: false,
  streamingReply: false,
  autoStart: false,
});

const defaultPermissions = (): ChannelPermissions => ({
  allowReadHome: false,
  readablePathPrefixes: [],
  allowWriteOutside: false,
  allowShell: false,
  allowSubAgents: false,
});

const normalizeSubscriptions = (
  subscriptions: ChannelSubscription[] | undefined,
): ChannelSubscription[] => {
  const deduped = new Map<string, ChannelSubscription>();
  for (const subscription of subscriptions ?? []) {
    deduped.set(subscription.chatId, {
      chatId: subscription.chatId,
      name: subscription.name.trim() || subscription.chatId,
      enabled: subscription.enabled,
    });
  }
  return Array.from(deduped.values());
};

const normalizeConfig = (config: Record<string, string>): Record<string, string> => {
  return Object.entries(config).reduce<Record<string, string>>((normalized, [key, value]) => {
    const trimmedValue = value.trim();
    if (trimmedValue.length > 0) {
      normalized[key] = trimmedValue;
    }
    return normalized;
  }, {});
};

export const materializeStoredChannels = (raw: unknown, ownerUserId: string): ChannelInstance[] => {
  if (!Array.isArray(raw)) {
    return [];
  }

  const channels: ChannelInstance[] = [];
  for (const candidate of raw) {
    const parsed = storedChannelSchema.safeParse(candidate);
    if (!parsed.success) {
      continue;
    }

    channels.push(normalizeChannel(parsed.data, ownerUserId));
  }

  return channels;
};

export const createChannelInstance = (
  input: ChannelCreateInput,
  ownerUserId: string,
  existing?: ChannelInstance,
): ChannelInstance => {
  const now = Date.now();
  return normalizeChannel(
    {
      ...input,
      tools: input.tools ?? existing?.tools,
      providerId: input.providerId === undefined ? existing?.providerId : input.providerId,
      model: input.model === undefined ? existing?.model : input.model,
      permissions: input.permissions ?? existing?.permissions,
      id: input.id ?? existing?.id ?? crypto.randomUUID(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ownerUserId,
    },
    ownerUserId,
  );
};

function normalizeChannel(input: StoredChannelInput, ownerUserId: string): ChannelInstance {
  return {
    id: input.id,
    type: input.type,
    name: input.name.trim(),
    enabled: input.enabled,
    config: normalizeConfig(input.config),
    tools: input.tools,
    providerId: input.providerId ?? null,
    model: input.model ?? null,
    features: { ...defaultFeatures(), ...(input.features ?? {}) },
    permissions: { ...defaultPermissions(), ...(input.permissions ?? {}) },
    subscriptions: normalizeSubscriptions(input.subscriptions),
    ownerUserId,
    createdAt: input.createdAt ?? Date.now(),
    updatedAt: input.updatedAt ?? Date.now(),
  };
}
