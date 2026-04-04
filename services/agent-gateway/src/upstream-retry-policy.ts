import { z } from 'zod';

export const DEFAULT_UPSTREAM_RETRY_MAX_RETRIES = 3;
export const MAX_UPSTREAM_RETRY_MAX_RETRIES = 3;
export const UPSTREAM_RETRY_MAX_RETRIES_KEY = 'upstreamRetryMaxRetries';
export const UPSTREAM_RETRY_SETTINGS_KEY = 'upstream_retry_policy_v1';

export const upstreamRetryMaxRetriesSchema = z
  .number()
  .int()
  .min(0)
  .max(MAX_UPSTREAM_RETRY_MAX_RETRIES);

export const upstreamRetrySettingsSchema = z.object({
  maxRetries: upstreamRetryMaxRetriesSchema.default(DEFAULT_UPSTREAM_RETRY_MAX_RETRIES),
});

export type UpstreamRetrySettings = z.infer<typeof upstreamRetrySettingsSchema>;

export function normalizeUpstreamRetryMaxRetries(value: unknown): number | undefined {
  const parsed = upstreamRetryMaxRetriesSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function readUpstreamRetrySettings(value: unknown): UpstreamRetrySettings {
  const parsed = upstreamRetrySettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : { maxRetries: DEFAULT_UPSTREAM_RETRY_MAX_RETRIES };
}
