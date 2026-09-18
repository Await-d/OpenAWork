import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { createPlatformAdapter } from '@openAwork/platform-adapter';

const CANONICAL_MODELS_URL = 'https://models.dev/models.json';

export interface CanonicalModelEntry {
  id: string;
  name?: string;
  family?: string;
}

export type CanonicalModelsData = Record<string, CanonicalModelEntry>;

function getCacheFilePath(): string {
  const adapter = createPlatformAdapter();
  return path.join(adapter.getDataDir(), 'models-canonical.json');
}

let _cache: CanonicalModelsData | null = null;
let _inFlight: Promise<CanonicalModelsData> | null = null;

async function readLocalCache(): Promise<CanonicalModelsData | null> {
  try {
    const filePath = getCacheFilePath();
    if (!existsSync(filePath)) return null;
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as CanonicalModelsData;
  } catch {
    return null;
  }
}

async function writeLocalCache(data: CanonicalModelsData): Promise<void> {
  try {
    const filePath = getCacheFilePath();
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(data), 'utf-8');
  } catch (err) {
    console.warn('[models-dev] failed to write canonical cache', err);
  }
}

async function fetchData(): Promise<CanonicalModelsData> {
  const res = await fetch(CANONICAL_MODELS_URL, {
    signal: AbortSignal.timeout(10_000),
    headers: { 'User-Agent': 'OpenAWork/1.0' },
  });
  if (!res.ok) throw new Error(`models.dev canonical fetch failed: ${res.status}`);
  return (await res.json()) as CanonicalModelsData;
}

async function fetchAndCache(): Promise<CanonicalModelsData> {
  if (_inFlight) return _inFlight;
  _inFlight = (async () => {
    try {
      const data = await fetchData();
      _cache = data;
      await writeLocalCache(data);
      return data;
    } finally {
      _inFlight = null;
    }
  })();
  return _inFlight;
}

export async function get(): Promise<CanonicalModelsData> {
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

export async function refresh(): Promise<void> {
  try {
    await fetchAndCache();
  } catch (err) {
    console.warn('[models-dev] canonical refresh failed', err);
  }
}

export function getSync(): CanonicalModelsData | null {
  return _cache;
}
