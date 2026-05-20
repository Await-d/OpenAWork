/**
 * 方案 3：Provider Catalog 缓存
 *
 * 避免每次请求都重建 ProviderManager。启动时/首次请求时构建，
 * 配置变更时 invalidate，30s TTL 兜底刷新。
 */
import type { AIProvider, ActiveSelection } from '@openAwork/agent-core';
import { ProviderManagerImpl } from '@openAwork/agent-core';
import { sqliteGet } from '../infra/db.js';

interface UserSettingRow {
  key: string;
  value: string;
}

interface CatalogEntry {
  manager: InstanceType<typeof ProviderManagerImpl>;
  providers: AIProvider[];
  activeSelection: ActiveSelection;
  builtAt: number;
}

/** Per-user catalog cache */
const catalogCache = new Map<string, CatalogEntry>();

/** Cache TTL — rebuild if older than 30s (covers background model-dev refresh) */
const CACHE_TTL_MS = 30_000;

function loadRawSettings(userId: string) {
  const providerRow = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'providers'`,
    [userId],
  );
  const selectionRow = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'active_selection'`,
    [userId],
  );
  return {
    rawProviders: providerRow?.value ? (JSON.parse(providerRow.value) as unknown) : null,
    rawSelection: selectionRow?.value ? (JSON.parse(selectionRow.value) as unknown) : null,
  };
}

/**
 * 获取用户的 provider catalog（带缓存）
 */
export async function getCatalog(userId: string): Promise<CatalogEntry> {
  const existing = catalogCache.get(userId);
  if (existing && Date.now() - existing.builtAt < CACHE_TTL_MS) {
    return existing;
  }

  const { rawProviders, rawSelection } = loadRawSettings(userId);

  const manager = rawProviders
    ? new ProviderManagerImpl({
        providers: rawProviders as AIProvider[],
        active: rawSelection as ActiveSelection | undefined,
      })
    : rawSelection
      ? new ProviderManagerImpl({ active: rawSelection as ActiveSelection })
      : new ProviderManagerImpl();

  await manager.syncFromModelsDev();
  const config = manager.getConfig();

  const entry: CatalogEntry = {
    manager,
    providers: config.providers,
    activeSelection: config.active,
    builtAt: Date.now(),
  };
  catalogCache.set(userId, entry);
  return entry;
}

/**
 * 配置变更后调用，强制下次请求重建 catalog
 */
export function invalidateCatalog(userId: string): void {
  catalogCache.delete(userId);
}

/**
 * 清除所有用户的 catalog 缓存（用于 models-dev 全局刷新后）
 */
export function invalidateAllCatalogs(): void {
  catalogCache.clear();
}

/**
 * 获取 chat provider 配置（热路径，用缓存）
 */
export async function getChatProvider(userId: string) {
  const catalog = await getCatalog(userId);
  const { provider, model } = catalog.manager.getChatProviderConfig();
  return { provider, modelId: model.id };
}

/**
 * 获取 fast provider 配置
 */
export async function getFastProvider(userId: string) {
  const catalog = await getCatalog(userId);
  const { provider, model } = catalog.manager.getFastProviderConfig();
  return { provider, modelId: model.id };
}

/**
 * 获取指定 provider + model 的配置（带 fallback 到 chat provider）
 */
export async function getProviderForSelection(
  userId: string,
  selection?: { providerId?: string; modelId?: string },
): Promise<{ provider: AIProvider; modelId: string } | null> {
  const catalog = await getCatalog(userId);

  if (!selection?.providerId || !selection.modelId) {
    return getChatProvider(userId);
  }

  const provider = catalog.providers.find((p) => p.id === selection.providerId && p.enabled);
  const model = provider?.defaultModels.find((m) => m.id === selection.modelId && m.enabled);

  if (!provider || !model) {
    return getChatProvider(userId);
  }

  return { provider, modelId: model.id };
}

/**
 * 获取 compaction provider 配置
 */
export async function getCompactionProvider(
  userId: string,
): Promise<{ provider: AIProvider; modelId: string } | null> {
  const catalog = await getCatalog(userId);
  const config = catalog.manager.getConfig();
  const selection = config.active.compaction;
  if (!selection) return null;

  const provider = catalog.providers.find((p) => p.id === selection.providerId && p.enabled);
  const model = provider?.defaultModels.find((m) => m.id === selection.modelId && m.enabled);
  if (!provider || !model) return null;

  return { provider, modelId: model.id };
}

/**
 * 获取 image provider 配置
 */
export async function getImageProvider(userId: string): Promise<{
  provider: AIProvider;
  modelId: string;
  model: AIProvider['defaultModels'][number];
} | null> {
  const catalog = await getCatalog(userId);
  const config = catalog.manager.getConfig();
  const selection = config.active.image;
  if (!selection) return null;

  const provider = catalog.providers.find((p) => p.id === selection.providerId && p.enabled);
  const model = provider?.defaultModels.find(
    (m) => m.id === selection.modelId && m.enabled && m.supportsImageGeneration === true,
  );
  if (!provider || !model) return null;

  return { provider, modelId: model.id, model };
}
