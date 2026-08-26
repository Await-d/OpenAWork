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
 * so callers can forward both to the native provider factory — the
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
  /** Forwarded so the workflow LLM picks the right native adapter. */
  providerType?: AIProvider['type'];
  /** Forwarded so per-provider Responses/anthropic_messages overrides apply. */
  upstreamProtocol?: AIProvider['upstreamProtocol'];
  openaiFastMode?: boolean;
  /**
   * 该 model 的每百万 token 单价（USD），来自用户 provider 配置里的 model 条目。
   * 提供给团队用量统计估算成本（reception/pm1/pm2 等非流式路径）。缺省时成本记 0。
   */
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  cacheReadPricePerMillion?: number;
  cacheWritePricePerMillion?: number;
}

/**
 * 可选的「每成员/每层」模型覆盖（Phase 2）。
 *
 * reception/pm1/pm2 层走 auxiliary LLM 路径，本身只认用户全局 fast/active 选择。
 * 当模板给该层成员显式绑定了 modelId/providerId 时，调用方把它作为 override 传入，
 * 引擎只解析该 provider+model（仍 enabled 时）；解析不到则返回 null，由调用方提示重绑。
 */
export interface AuxiliaryModelOverride {
  providerId?: string;
  modelId?: string;
}

export async function resolveAuxiliaryLlmConfig(
  userId: string,
  override?: AuxiliaryModelOverride,
): Promise<ResolvedAuxiliaryLlmConfig | null> {
  const configs = await resolveAuxiliaryLlmConfigs({
    collectAll: false,
    override,
    userId,
  });
  return configs[0] ?? null;
}

/**
 * 返回辅助 LLM 的可用候选列表，顺序仍然保持：
 * 无 override 时返回 fast / inline → active chat → env fallback。
 * 有 override 时只返回 override 指定的 provider/model，避免 Team 层级绑定被默认模型覆盖。
 *
 * 用于质量评审这类后台收口任务：首选 provider 临时返回非 JSON / 502 /
 * 协议错误时，可以在同一轮内试下一个候选，避免 PM2 长时间停在
 * qualityReviewPending 的自动重试循环。
 */
export async function resolveAuxiliaryLlmConfigCandidates(
  userId: string,
  override?: AuxiliaryModelOverride,
): Promise<ResolvedAuxiliaryLlmConfig[]> {
  return resolveAuxiliaryLlmConfigs({
    collectAll: true,
    override,
    userId,
  });
}

async function resolveAuxiliaryLlmConfigs(input: {
  collectAll: boolean;
  override?: AuxiliaryModelOverride;
  userId: string;
}): Promise<ResolvedAuxiliaryLlmConfig[]> {
  const providersRow = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'providers'`,
    [input.userId],
  );
  const selectionRow = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'active_selection'`,
    [input.userId],
  );
  const rawProviders = parseUserSettingValue(providersRow?.value, 'providers');
  const rawSelection = parseUserSettingValue(selectionRow?.value, 'active_selection');
  const hasStoredProviders = Array.isArray(rawProviders) && rawProviders.length > 0;
  const configs: ResolvedAuxiliaryLlmConfig[] = [];
  const seen = new Set<string>();
  const pushResolved = (
    cfg: Awaited<ReturnType<typeof getFastProviderConfig>>,
  ): ResolvedAuxiliaryLlmConfig | null => {
    if (!cfg) return null;
    const resolved = resolveProviderCredentials(cfg.provider, cfg.modelId);
    if (!resolved) return null;
    const key = buildResolvedConfigKey(resolved);
    if (seen.has(key)) return null;
    seen.add(key);
    configs.push(resolved);
    return resolved;
  };

  if (input.override?.providerId && input.override.modelId) {
    if (!hasStoredProviders) {
      return [];
    }
    const cfg = await getProviderConfigForSelection(
      rawProviders,
      rawSelection,
      {
        providerId: input.override.providerId,
        modelId: input.override.modelId,
      },
      { fallbackToChat: false },
    );
    const resolved = pushResolved(cfg);
    return resolved ? configs : [];
  }

  if (hasStoredProviders) {
    const candidates = [
      () => getFastProviderConfig(rawProviders, rawSelection),
      () => getActiveChatProviderConfig(rawProviders, rawSelection),
    ];
    for (const lookup of candidates) {
      const cfg = await lookup();
      const resolved = pushResolved(cfg);
      if (resolved && !input.collectAll) {
        return configs;
      }
    }
  }

  const envBase = (process.env['AI_API_BASE_URL'] ?? '').trim();
  const envKey = (process.env['AI_API_KEY'] ?? '').trim();
  const envModel = (process.env['AI_DEFAULT_MODEL'] ?? 'gpt-4o').trim();
  if (envBase && envKey) {
    const resolved = { apiBaseUrl: envBase, apiKey: envKey, model: envModel };
    const key = buildResolvedConfigKey(resolved);
    if (!seen.has(key)) {
      configs.push(resolved);
    }
  }
  return configs;
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
    ...(provider.openaiFastMode === true ? { openaiFastMode: true } : {}),
    ...(provider.upstreamProtocol ? { upstreamProtocol: provider.upstreamProtocol } : {}),
    ...(typeof modelEntry?.inputPricePerMillion === 'number'
      ? { inputPricePerMillion: modelEntry.inputPricePerMillion }
      : {}),
    ...(typeof modelEntry?.outputPricePerMillion === 'number'
      ? { outputPricePerMillion: modelEntry.outputPricePerMillion }
      : {}),
    ...(typeof modelEntry?.cacheReadPricePerMillion === 'number'
      ? { cacheReadPricePerMillion: modelEntry.cacheReadPricePerMillion }
      : {}),
    ...(typeof modelEntry?.cacheWritePricePerMillion === 'number'
      ? { cacheWritePricePerMillion: modelEntry.cacheWritePricePerMillion }
      : {}),
  };
}

function buildResolvedConfigKey(config: ResolvedAuxiliaryLlmConfig): string {
  return [
    config.providerType ?? '',
    config.upstreamProtocol ?? '',
    config.openaiFastMode === true ? 'priority' : '',
    config.apiBaseUrl,
    config.model,
    config.apiKey,
  ].join('\0');
}

function pickProviderApiKey(provider: AIProvider): string | null {
  if (provider.apiKey && provider.apiKey.length > 0) return provider.apiKey;
  if (provider.apiKeyEnv) {
    const fromEnv = process.env[provider.apiKeyEnv];
    if (fromEnv && fromEnv.length > 0) return fromEnv;
  }
  return null;
}
