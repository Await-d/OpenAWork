import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { createPlatformAdapter } from '@openAwork/platform-adapter';
import {
  getCatalogEntry,
  inferProviderTypeFromHostname,
  normalizeProviderAlias,
} from './catalog.js';
import type { BuiltinProviderType } from './presets.js';
import type { AIModelConfig } from './types.js';
import { normalizeOptionalTokenPrice } from './utils.js';

const MODELS_DEV_URL = 'https://models.dev/api.json';
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;

function getCacheFilePath(): string {
  const adapter = createPlatformAdapter();
  return path.join(adapter.getDataDir(), 'models.json');
}

export interface ModelsDevModel {
  id: string;
  name: string;
  description?: string;
  cost?: {
    input: number;
    output: number;
    cache_read?: number;
    cache_write?: number;
  };
  limit?: {
    context: number;
    output: number;
    input?: number;
  };
  tool_call?: boolean;
  reasoning?: boolean;
  reasoning_options?: Array<{
    type: string;
    values?: string[];
  }>;
  attachment?: boolean;
  knowledge?: string;
  interleaved?: boolean | { field: string };
  structured_output?: boolean;
  temperature?: boolean;
  modalities?: {
    input?: string[];
    output?: string[];
  };
  status?: 'alpha' | 'beta' | 'deprecated';
  family?: string;
  release_date?: string;
  last_updated?: string;
  open_weights?: boolean;
  provider?: {
    npm?: string;
    api?: string;
  };
  experimental?: Record<string, unknown>;
  options?: Record<string, unknown>;
}

export interface ModelsDevProvider {
  id: string;
  name: string;
  env?: string[];
  api?: string;
  npm?: string;
  models: Record<string, ModelsDevModel>;
}

export type ModelsDevData = Record<string, ModelsDevProvider>;

export function resolveModelsDevProvider(
  data: ModelsDevData | undefined,
  type: BuiltinProviderType,
  builtinId: string,
): ModelsDevProvider | undefined {
  if (!data) {
    return undefined;
  }

  const direct = data[type] ?? data[builtinId];
  if (direct) {
    return direct;
  }

  const configuredId = getCatalogEntry(type)?.modelsDevIds?.find((id) => data[id]);
  if (configuredId) {
    return data[configuredId];
  }

  return Object.entries(data).find(([key, provider]) => {
    if (
      normalizeProviderAlias(key) === type ||
      normalizeProviderAlias(provider.id || key) === type
    ) {
      return true;
    }

    if (!provider.api) {
      return false;
    }

    try {
      return inferProviderTypeFromHostname(new URL(provider.api).hostname) === type;
    } catch {
      return false;
    }
  })?.[1];
}

export function mapModelsDevModel(modelId: string, model: ModelsDevModel): AIModelConfig {
  const inputModalities = model.modalities?.input;
  const outputModalities = model.modalities?.output;
  return {
    id: modelId,
    label: model.name || modelId,
    enabled: model.status !== 'deprecated',
    description: model.description,
    family: model.family,
    releaseDate: model.release_date,
    lastUpdated: model.last_updated,
    openWeights: model.open_weights,
    knowledgeCutoff: model.knowledge,
    supportsInterleavedReasoning: model.interleaved !== undefined && model.interleaved !== false,
    reasoningContentField:
      typeof model.interleaved === 'object' ? model.interleaved.field : undefined,
    providerNpm: model.provider?.npm,
    providerApi: model.provider?.api,
    experimental: model.experimental ? { ...model.experimental } : undefined,
    modelsDevOptions: model.options ? { ...model.options } : undefined,
    supportsAttachments: model.attachment,
    supportsTools: model.tool_call ?? false,
    supportsVision: inputModalities?.includes('image') ?? false,
    supportsAudioInput: inputModalities?.includes('audio') ?? false,
    supportsVideoInput: inputModalities?.includes('video') ?? false,
    supportsAudioOutput: outputModalities?.includes('audio') ?? false,
    supportsVideoGeneration: outputModalities?.includes('video') ?? false,
    supportsStructuredOutput: model.structured_output,
    supportsTemperature: model.temperature,
    supportsThinking: model.reasoning ?? false,
    inputModalities: inputModalities ? [...inputModalities] : undefined,
    outputModalities: outputModalities ? [...outputModalities] : undefined,
    reasoningOptions: model.reasoning_options?.map((option) => ({
      type: option.type,
      values: option.values ? [...option.values] : undefined,
    })),
    contextWindow: model.limit?.context,
    maxOutputTokens: model.limit?.output,
    inputPricePerMillion: normalizeOptionalTokenPrice(model.cost?.input),
    outputPricePerMillion: normalizeOptionalTokenPrice(model.cost?.output),
    cacheReadPricePerMillion: normalizeOptionalTokenPrice(model.cost?.cache_read),
    cacheWritePricePerMillion: normalizeOptionalTokenPrice(model.cost?.cache_write),
  };
}

let _cache: ModelsDevData | null = null;
let _timer: ReturnType<typeof setInterval> | null = null;
// Single-flight guard for the network fetch + cache publish. Without it,
// every concurrent caller hits the network independently: N users booting
// at once each fire their own cold-start `get()` -> `fetchData()` (a
// thundering herd against models.dev), and an interval-driven `refresh()`
// can overlap a still-pending slow refresh. Both race each other's `_cache`
// assignment and `writeLocalCache` file write. Sharing one in-flight promise
// collapses concurrent callers onto a single request; the slot is released
// in `finally` so a failed fetch never wedges future refreshes.
let _inFlightFetch: Promise<ModelsDevData> | null = null;

async function readLocalCache(): Promise<ModelsDevData | null> {
  try {
    const filePath = getCacheFilePath();
    if (!existsSync(filePath)) return null;
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as ModelsDevData;
  } catch {
    return null;
  }
}

async function writeLocalCache(data: ModelsDevData): Promise<void> {
  try {
    const filePath = getCacheFilePath();
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(data), 'utf-8');
  } catch (err) {
    console.warn('[models-dev] failed to write local cache', err);
  }
}

async function fetchData(): Promise<ModelsDevData> {
  const res = await fetch(MODELS_DEV_URL, {
    signal: AbortSignal.timeout(10_000),
    headers: { 'User-Agent': 'OpenAWork/1.0' },
  });
  if (!res.ok) throw new Error(`models.dev fetch failed: ${res.status}`);
  return (await res.json()) as ModelsDevData;
}

async function fetchAndCache(): Promise<ModelsDevData> {
  // Reuse the in-flight request if one is already running so concurrent
  // callers don't each open a separate socket to models.dev.
  if (_inFlightFetch) return _inFlightFetch;
  _inFlightFetch = (async () => {
    try {
      const data = await fetchData();
      _cache = data;
      await writeLocalCache(data);
      return data;
    } finally {
      // Release the slot whether the fetch resolved or rejected, otherwise
      // a single failed refresh would permanently block every later one.
      _inFlightFetch = null;
    }
  })();
  return _inFlightFetch;
}

export async function refresh(): Promise<void> {
  try {
    await fetchAndCache();
  } catch (err) {
    console.warn('[models-dev] refresh failed', err);
  }
}

/**
 * Force a fresh fetch from models.dev and publish it to the cache, **rethrowing**
 * on failure. `refresh()` deliberately swallows errors (it backs an unattended
 * hourly timer where a transient network blip should be ignored). A user-driven
 * "sync now" action needs the opposite: surface the failure so the caller can
 * tell the user it didn't work, instead of silently reporting success off a
 * stale cache left by an earlier successful fetch.
 */
export async function refreshOrThrow(): Promise<ModelsDevData> {
  return fetchAndCache();
}

export async function get(): Promise<ModelsDevData> {
  if (_cache) return _cache;
  const local = await readLocalCache();
  if (local) {
    _cache = local;
    return _cache;
  }
  try {
    return await fetchAndCache();
  } catch {
    _cache = {};
  }
  return _cache;
}

export function getSync(): ModelsDevData | null {
  return _cache;
}

export function startPeriodicRefresh(): void {
  if (_timer) return;
  void get();
  _timer = setInterval(() => {
    void refresh();
  }, REFRESH_INTERVAL_MS);
  if (typeof _timer === 'object' && _timer !== null && 'unref' in _timer) {
    _timer.unref();
  }
}

export function stopPeriodicRefresh(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}
