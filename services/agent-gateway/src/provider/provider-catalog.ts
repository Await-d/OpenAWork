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

/**
 * Hard ceiling on `catalogCache` entries. The cache keys on `userId` and the
 * 30s TTL only gates *reuse* on read — it never deletes a stale entry. Each
 * entry holds a full `ProviderManagerImpl` (the model catalog synced from
 * models.dev), so on a multi-user install the map would grow one heavyweight
 * entry per user who ever issued a request and never shrink. We sweep expired
 * entries opportunistically and cap the total, evicting oldest-first.
 */
const CATALOG_CACHE_MAX_ENTRIES = 1_000;

/**
 * Drop entries older than the TTL (already unusable — `getCatalog` would
 * rebuild them anyway), then if still over the cap evict oldest-first by
 * `builtAt`. Called after each insert so the map stays bounded by the number
 * of users active within one TTL window rather than the all-time user count.
 */
function pruneCatalogCache(): void {
  const now = Date.now();
  for (const [userId, entry] of catalogCache) {
    if (now - entry.builtAt >= CACHE_TTL_MS) {
      catalogCache.delete(userId);
    }
  }
  if (catalogCache.size <= CATALOG_CACHE_MAX_ENTRIES) {
    return;
  }
  const byAge = [...catalogCache.entries()].sort((a, b) => a[1].builtAt - b[1].builtAt);
  const excess = catalogCache.size - CATALOG_CACHE_MAX_ENTRIES;
  for (let i = 0; i < excess; i += 1) {
    const victim = byAge[i];
    if (victim) catalogCache.delete(victim[0]);
  }
}

/**
 * Parse a stored `user_settings` JSON value without letting one corrupt row
 * throw. These columns are persisted via JSON.stringify, but a crash
 * mid-write, a disk error, or a hand-edited DB can leave a non-JSON value. An
 * unguarded `JSON.parse` here used to throw straight out of `loadRawSettings`
 * → `getCatalog`, which sits on the main chat stream path (stream.ts →
 * getFastProvider / getProviderForSelection) — so a single corrupt provider
 * row hard-failed every chat turn for that user. Degrade a corrupt value to
 * `null` (identical to the no-row path: `getCatalog` then builds a default
 * `ProviderManagerImpl`) + warn. (§0.94 / §0.115 single-point-failure class.)
 */
function parseStoredSettingValue(value: string | undefined, key: string): unknown {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch (err) {
    console.warn(
      `[provider-catalog] user_settings '${key}' JSON 解析失败，按未配置处理：${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

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
    rawProviders: parseStoredSettingValue(providerRow?.value, 'providers'),
    rawSelection: parseStoredSettingValue(selectionRow?.value, 'active_selection'),
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
  pruneCatalogCache();
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
 * Test-only seams for the catalog cache retention guard. Kept minimal so the
 * cap / expiry logic is verifiable without building a real ProviderManager.
 */
export function __seedCatalogCacheForTest(userId: string, builtAtMs: number): void {
  catalogCache.set(userId, {
    manager: undefined as never,
    providers: [],
    activeSelection: {} as never,
    builtAt: builtAtMs,
  });
}
export function __getCatalogCacheSizeForTest(): number {
  return catalogCache.size;
}
export function __pruneCatalogCacheForTest(): void {
  pruneCatalogCache();
}
export const __CATALOG_CACHE_MAX_ENTRIES_FOR_TEST = CATALOG_CACHE_MAX_ENTRIES;
export const __CATALOG_CACHE_TTL_MS_FOR_TEST = CACHE_TTL_MS;

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

interface ProviderSelectionOptions {
  fallbackToChat?: boolean;
}

/**
 * 获取指定 provider + model 的配置。默认沿用历史行为：找不到时 fallback 到 chat
 * provider；调用方传 `fallbackToChat: false` 时用于会话级固定模型，找不到就返回 null。
 */
export async function getProviderForSelection(
  userId: string,
  selection?: { providerId?: string; modelId?: string },
  options: ProviderSelectionOptions = {},
): Promise<{ provider: AIProvider; modelId: string } | null> {
  const catalog = await getCatalog(userId);
  const fallbackToChat = options.fallbackToChat !== false;

  if (!selection?.providerId || !selection.modelId) {
    return fallbackToChat ? getChatProvider(userId) : null;
  }

  const provider = catalog.providers.find((p) => p.id === selection.providerId && p.enabled);
  const model = provider?.defaultModels.find((m) => m.id === selection.modelId && m.enabled);

  if (!provider || !model) {
    return fallbackToChat ? getChatProvider(userId) : null;
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
