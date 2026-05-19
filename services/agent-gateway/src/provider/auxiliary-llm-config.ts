/**
 * Shared resolver for the *auxiliary* (non-agent) LLM credentials that
 * power lightweight gateway-side workflows: prompt optimizer / translator
 * (`routes/workflows.ts`), team interaction-agent rewrite + leader
 * dispatch (`routes/team.ts`), and the companion (宠物) chat
 * (`routes/settings.ts`).
 *
 * Preference order (matches the prompt-optimizer migration that
 * `routes/workflows.ts` originally pioneered, which intentionally moved
 * away from gateway-level `AI_API_*` env vars in favour of the user's
 * own configured providers):
 *   1. user-configured "fast / inline" provider (设置 → 提供商),
 *   2. user-configured "active chat" provider as fallback,
 *   3. process env (`AI_API_BASE_URL` / `AI_API_KEY` / `AI_DEFAULT_MODEL`)
 *      as the last-resort legacy path.
 *
 * The resolved record carries `providerType` and `upstreamProtocol`
 * so callers can forward both to the AI SDK provider factory — the
 * critical bit that prevents silent degradation to OpenAI Chat
 * Completions for users on `anthropic_messages` / `responses`. The 3
 * call sites that previously read env vars directly all bypassed
 * `providerType`/`upstreamProtocol` entirely, which was a systemic
 * extension of the bug already fixed in compaction / session-title /
 * skill-recommend / look-at-tools.
 *
 * Returns `null` when no usable credentials are found in any source —
 * the caller is responsible for surfacing a structured 503 hint.
 */

import type { AIProvider } from '@openAwork/agent-core';
import { sqliteGet } from '../db.js';
import { getActiveChatProviderConfig, getFastProviderConfig } from './provider-config.js';

interface UserSettingRow {
  value: string;
}

export interface ResolvedAuxiliaryLlmConfig {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  /** Forwarded so the workflow LLM picks the right AI SDK adapter. */
  providerType?: AIProvider['type'];
  /** Forwarded so per-provider Responses/anthropic_messages overrides apply. */
  upstreamProtocol?: AIProvider['upstreamProtocol'];
}

export async function resolveAuxiliaryLlmConfig(
  userId: string,
): Promise<ResolvedAuxiliaryLlmConfig | null> {
  const providersRow = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'providers'`,
    [userId],
  );
  const selectionRow = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'active_selection'`,
    [userId],
  );
  const rawProviders = providersRow?.value ? JSON.parse(providersRow.value) : undefined;
  const rawSelection = selectionRow?.value ? JSON.parse(selectionRow.value) : undefined;

  const candidates = [
    () => getFastProviderConfig(rawProviders, rawSelection),
    () => getActiveChatProviderConfig(rawProviders, rawSelection),
  ];
  for (const lookup of candidates) {
    const cfg = await lookup();
    if (!cfg) continue;
    const resolved = resolveProviderCredentials(cfg.provider, cfg.modelId);
    if (resolved) return resolved;
  }

  const envBase = (process.env['AI_API_BASE_URL'] ?? '').trim();
  const envKey = (process.env['AI_API_KEY'] ?? '').trim();
  const envModel = (process.env['AI_DEFAULT_MODEL'] ?? 'gpt-4o').trim();
  if (envBase && envKey) {
    return { apiBaseUrl: envBase, apiKey: envKey, model: envModel };
  }
  return null;
}

function resolveProviderCredentials(
  provider: AIProvider,
  modelId: string,
): ResolvedAuxiliaryLlmConfig | null {
  const apiBaseUrl = (provider.baseUrl ?? '').trim();
  if (!apiBaseUrl) return null;
  const apiKey = pickProviderApiKey(provider);
  if (!apiKey) return null;
  return {
    apiBaseUrl,
    apiKey,
    model: modelId,
    providerType: provider.type,
    ...(provider.upstreamProtocol ? { upstreamProtocol: provider.upstreamProtocol } : {}),
  };
}

function pickProviderApiKey(provider: AIProvider): string | null {
  if (provider.apiKey && provider.apiKey.length > 0) return provider.apiKey;
  if (provider.apiKeyEnv) {
    const fromEnv = process.env[provider.apiKeyEnv];
    if (fromEnv && fromEnv.length > 0) return fromEnv;
  }
  return null;
}
