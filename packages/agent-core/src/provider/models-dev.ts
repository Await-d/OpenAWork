import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { createPlatformAdapter } from '@openAwork/platform-adapter';

const MODELS_DEV_URL = 'https://models.dev/api.json';
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;

function getCacheFilePath(): string {
  const adapter = createPlatformAdapter();
  return path.join(adapter.getDataDir(), 'models.json');
}

export interface ModelsDevModel {
  id: string;
  name: string;
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
  attachment?: boolean;
  temperature?: boolean;
  modalities?: {
    input?: string[];
    output?: string[];
  };
  status?: 'alpha' | 'beta' | 'deprecated';
  family?: string;
  release_date?: string;
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

let _cache: ModelsDevData | null = null;
let _timer: ReturnType<typeof setInterval> | null = null;

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

export async function refresh(): Promise<void> {
  try {
    const data = await fetchData();
    _cache = data;
    await writeLocalCache(data);
  } catch (err) {
    console.warn('[models-dev] refresh failed', err);
  }
}

export async function get(): Promise<ModelsDevData> {
  if (_cache) return _cache;
  const local = await readLocalCache();
  if (local) {
    _cache = local;
    return _cache;
  }
  try {
    const data = await fetchData();
    _cache = data;
    await writeLocalCache(data);
  } catch {
    _cache = {} as ModelsDevData;
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
