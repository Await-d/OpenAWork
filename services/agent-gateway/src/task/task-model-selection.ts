import { sqliteGet } from '../infra/db.js';
import { normalizeProviderAlias } from '@openAwork/agent-core';
import { aiProviderSchema, materializeProviderConfig } from '../provider/provider-config.js';
import { resolveModelRouteFromProvider } from '../provider/model-router.js';
import type { ReferenceModelEntry } from './task-model-reference-snapshot.js';

interface UserSettingRow {
  value: string;
}

interface StoredProvider {
  id?: string;
  type?: string;
}

export interface DelegatedModelSelection {
  modelId: string;
  providerId?: string;
  variant?: string;
}

function normalizeProviderHint(value: string): string {
  // 由 catalog 的别名表归一(如 google→gemini, moonshotai→moonshot, xiaomi→mimo)。
  return normalizeProviderAlias(value);
}

function providerMatchesHints(provider: StoredProvider, hints: string[]): boolean {
  if (hints.length === 0) {
    return true;
  }
  const providerKeys = new Set(
    [provider.id, provider.type]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => value.trim().toLowerCase())
      .flatMap((value) => [value, normalizeProviderHint(value)]),
  );
  return hints.some((hint) => providerKeys.has(normalizeProviderHint(hint)));
}

function parseProviders(value: string | undefined) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((provider: unknown) => {
      const result = aiProviderSchema.safeParse(provider);
      return result.success ? [result.data] : [];
    });
  } catch {
    return [];
  }
}

export async function selectDelegatedModelForUser(
  userId: string,
  modelCandidates: string[] | ReferenceModelEntry[],
): Promise<DelegatedModelSelection | undefined> {
  const candidates: ReferenceModelEntry[] =
    Array.isArray(modelCandidates) && typeof modelCandidates[0] === 'object'
      ? (modelCandidates as ReferenceModelEntry[])
      : Array.from(
          new Set((modelCandidates as string[]).map((item) => item.trim()).filter(Boolean)),
        ).map((modelId) => ({ modelId, providerHints: [] }));
  if (candidates.length === 0) {
    return undefined;
  }

  const providersRow = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'providers'`,
    [userId],
  );
  const storedProviders = parseProviders(providersRow?.value);
  if (storedProviders.length === 0) return undefined;
  // 落库存的是覆盖项，先还原完整模型目录；目录同步补入的其他平台不能算用户已接入。
  const configuredProviderIds = new Set(storedProviders.map((provider) => provider.id));
  const config = await materializeProviderConfig(storedProviders, undefined);
  const providers = config.providers.filter(
    (provider) => configuredProviderIds.has(provider.id) && provider.enabled,
  );

  for (const candidate of candidates) {
    const matchedProvider = providers.find(
      (provider) =>
        providerMatchesHints(provider, candidate.providerHints) &&
        provider.defaultModels?.some((model) => model.enabled && model.id === candidate.modelId) &&
        // 使用实际请求路由的凭据解析（含环境变量及插件），避免只启用平台却未配置密钥。
        (provider.type === 'ollama' ||
          resolveModelRouteFromProvider(provider, candidate.modelId, {
            temperature: 1,
          }).apiKey.trim().length > 0),
    );
    if (matchedProvider?.id) {
      return {
        providerId: matchedProvider.id,
        modelId: candidate.modelId,
        variant: candidate.variant,
      };
    }
  }

  // 推荐列表不代表平台实际接入；由调用方继承当前模型或使用已配置的默认模型。
  return undefined;
}
