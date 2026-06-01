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
import { sqliteGet } from '../infra/db.js';
import {
  getActiveChatProviderConfig,
  getFastProviderConfig,
  getProviderConfigForSelection,
} from './provider-config.js';

interface UserSettingRow {
  value: string;
}

/**
 * Tolerant parse for the `providers` / `active_selection` user-setting rows.
 * These columns are persisted via JSON.stringify, but a crash mid-write, a
 * disk error, or a hand-edited DB can leave a non-JSON value. An unguarded
 * `JSON.parse` here used to throw straight out of `resolveAuxiliaryLlmConfig`
 * — which not only failed the immediate caller (reception-orchestrator,
 * pm1/pm2 runners, the quality-review reconciler, settings, workflows) but
 * also short-circuited the `AI_API_*` env-var fallback at the tail of this
 * function, so a user with otherwise-valid env credentials still couldn't run
 * any team handoff. Degrade a corrupt row to `undefined` (same as a missing
 * row) + warn so resolution proceeds down the preference chain. (§0.94 class.)
 */
function parseUserSettingValue(value: string | undefined, key: string): unknown {
  if (!value) {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch (err) {
    console.warn(
      `[auxiliary-llm-config] user_settings '${key}' JSON 解析失败，按未配置处理：${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return undefined;
  }
}

export interface ResolvedAuxiliaryLlmConfig {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  /** Forwarded so the workflow LLM picks the right AI SDK adapter. */
  providerType?: AIProvider['type'];
  /** Forwarded so per-provider Responses/anthropic_messages overrides apply. */
  upstreamProtocol?: AIProvider['upstreamProtocol'];
  /**
   * 该 model 的每百万 token 单价（USD），来自用户 provider 配置里的 model 条目。
   * 提供给团队用量统计估算成本（reception/pm1/pm2 等非流式路径）。缺省时成本记 0。
   */
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
}

/**
 * 可选的「每成员/每层」模型覆盖（Phase 2）。
 *
 * reception/pm1/pm2 层走 auxiliary LLM 路径，本身只认用户全局 fast/active 选择。
 * 当模板给该层成员显式绑定了 modelId/providerId 时，调用方把它作为 override 传入，
 * 引擎会优先解析该 provider+model（仍 enabled 时）；解析不到则回退原有优先级链。
 */
export interface AuxiliaryModelOverride {
  providerId?: string;
  modelId?: string;
}

export async function resolveAuxiliaryLlmConfig(
  userId: string,
  override?: AuxiliaryModelOverride,
): Promise<ResolvedAuxiliaryLlmConfig | null> {
  const providersRow = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'providers'`,
    [userId],
  );
  const selectionRow = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'active_selection'`,
    [userId],
  );
  const rawProviders = parseUserSettingValue(providersRow?.value, 'providers');
  const rawSelection = parseUserSettingValue(selectionRow?.value, 'active_selection');

  // Phase 2：显式成员模型优先。getProviderConfigForSelection 在 model 失活/缺失时
  // 会自动回退到 chat 配置，因此这里既是优先项也是 Phase 3 的兜底。
  if (override?.providerId && override.modelId) {
    const cfg = await getProviderConfigForSelection(rawProviders, rawSelection, {
      providerId: override.providerId,
      modelId: override.modelId,
    });
    if (cfg) {
      const resolved = resolveProviderCredentials(cfg.provider, cfg.modelId);
      if (resolved) return resolved;
    }
  }

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
  // 从 provider 的 model 列表里找该 model 的单价（用于成本估算）。找不到也无妨。
  const modelEntry = Array.isArray(provider.defaultModels)
    ? provider.defaultModels.find((m) => m.id === modelId)
    : undefined;
  return {
    apiBaseUrl,
    apiKey,
    model: modelId,
    providerType: provider.type,
    ...(provider.upstreamProtocol ? { upstreamProtocol: provider.upstreamProtocol } : {}),
    ...(typeof modelEntry?.inputPricePerMillion === 'number'
      ? { inputPricePerMillion: modelEntry.inputPricePerMillion }
      : {}),
    ...(typeof modelEntry?.outputPricePerMillion === 'number'
      ? { outputPricePerMillion: modelEntry.outputPricePerMillion }
      : {}),
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
