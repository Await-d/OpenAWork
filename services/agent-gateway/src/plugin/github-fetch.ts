/**
 * GitHub fetch helpers for the plugin market.
 *
 * Mirrors the skill-registry safety semantics (`packages/skill-registry/src/http.ts`
 * + `installers/github.ts`):
 *   - streaming bounded reads — an oversized body is aborted the moment the
 *     cap is crossed, never fully buffered
 *   - `content-length` pre-check rejects early
 *   - zip entries are checked against a total **expanded** budget from the
 *     header (`originalSize`) before decompression — zip-bomb guard
 *   - extraction has a zip-slip guard: entries with `..` / absolute paths are
 *     skipped, and every target must stay under the destination root
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { unzipSync, type UnzipFileInfo } from 'fflate';

export const PLUGIN_FETCH_TIMEOUT_MS = 20_000;
export const PLUGIN_MAX_METADATA_BYTES = 2 * 1024 * 1024;
export const PLUGIN_MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
export const PLUGIN_MAX_EXPANDED_BYTES = 200 * 1024 * 1024;

export class PluginFetchError extends Error {
  override name = 'PluginFetchError';
}

function fetchErrorMessage(url: string, err: unknown): PluginFetchError {
  return new PluginFetchError(
    `请求 ${url} 失败：${err instanceof Error ? err.message : String(err)}`,
  );
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = PLUGIN_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    throw fetchErrorMessage(url, err);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read a `Response` body without buffering more than `maxBytes`.
 * Rejects up front on an over-limit `content-length`, otherwise streams and
 * aborts the moment the cap is crossed.
 */
async function readBoundedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new PluginFetchError(`响应体过大：content-length ${declared} 超过上限 ${maxBytes} 字节`);
  }

  if (!response.body) {
    return new Uint8Array(await response.arrayBuffer());
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new PluginFetchError(`响应体过大：超过上限 ${maxBytes} 字节`);
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/** Fetch a small text resource (manifest / README) with a bounded read. */
export async function fetchTextWithLimit(
  url: string,
  maxBytes = PLUGIN_MAX_METADATA_BYTES,
): Promise<string> {
  const response = await fetchWithTimeout(url, { headers: { accept: 'text/plain' } });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new PluginFetchError(`HTTP ${response.status}：${url}`);
  }
  const bytes = await readBoundedBytes(response, maxBytes);
  return new TextDecoder().decode(bytes);
}

/** Fetch and parse a small JSON resource with a bounded read. */
export async function fetchJsonWithLimit<T>(
  url: string,
  maxBytes = PLUGIN_MAX_METADATA_BYTES,
): Promise<T> {
  const text = await fetchTextWithLimit(url, maxBytes);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new PluginFetchError(`JSON 解析失败：${url}`);
  }
}

/** `https://raw.githubusercontent.com/<owner>/<repo>/<ref|HEAD>/<path>` */
export function githubRawUrl(
  owner: string,
  repo: string,
  ref: string | undefined,
  path: string,
): string {
  const refPart = ref && ref.trim().length > 0 ? ref : 'HEAD';
  const cleanPath = path.replace(/^\/+/, '');
  return `https://raw.githubusercontent.com/${owner}/${repo}/${refPart}/${cleanPath}`;
}

/** Download a GitHub repo zipball (bounded). */
export async function downloadGitHubZipball(
  owner: string,
  repo: string,
  ref?: string,
): Promise<Uint8Array> {
  const url = ref
    ? `https://api.github.com/repos/${owner}/${repo}/zipball/${ref}`
    : `https://api.github.com/repos/${owner}/${repo}/zipball`;
  const response = await fetchWithTimeout(url, {
    headers: { accept: 'application/vnd.github+json' },
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new PluginFetchError(`下载仓库失败（HTTP ${response.status}）：${owner}/${repo}`);
  }
  return readBoundedBytes(response, PLUGIN_MAX_ARCHIVE_BYTES);
}

/**
 * Unzip a zipball with a total-expansion budget (zip-bomb guard) and the
 * GitHub root directory (`<owner>-<repo>-<sha>/`) stripped. Entries that
 * only represent directories are skipped.
 */
export function unzipPluginArchive(
  bytes: Uint8Array,
  maxExpandedBytes = PLUGIN_MAX_EXPANDED_BYTES,
): Map<string, Uint8Array> {
  let expanded = 0;
  const raw = unzipSync(bytes, {
    filter: (file: UnzipFileInfo) => {
      expanded += file.originalSize;
      if (expanded > maxExpandedBytes) {
        throw new PluginFetchError(`插件包解压后超过上限（${maxExpandedBytes} 字节），已拒绝。`);
      }
      return true;
    },
  });

  const entries = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(raw)) {
    const normalized = name.replace(/\\/g, '/');
    const slash = normalized.indexOf('/');
    // GitHub zipballs wrap everything in a single root directory.
    if (slash === -1) continue;
    const relative = normalized.slice(slash + 1);
    if (relative.length === 0 || relative.endsWith('/')) continue;
    entries.set(relative, data);
  }
  return entries;
}

/** Reject absolute paths, `..`, empty and dot segments (zip-slip guard). */
function sanitizeRelativePath(relative: string): string | null {
  if (relative.startsWith('/') || /^[a-zA-Z]:/.test(relative)) return null;
  const segments = relative.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    return null;
  }
  return segments.join('/');
}

/**
 * Write the entries under `subPath` ('' = archive root) into `destination`.
 * Returns the number of files written.
 */
export async function extractZipSubtreeToDirectory(
  entries: Map<string, Uint8Array>,
  subPath: string,
  destination: string,
): Promise<number> {
  const normalizedSub = subPath.replace(/^\/+|\/+$/g, '');
  const prefix = normalizedSub.length === 0 ? '' : `${normalizedSub}/`;
  const root = resolve(destination);
  let written = 0;

  for (const [rawName, data] of entries) {
    if (!rawName.startsWith(prefix)) continue;
    const relative = rawName.slice(prefix.length);
    if (relative.length === 0) continue;
    const safeRelative = sanitizeRelativePath(relative);
    if (safeRelative === null) continue;
    const target = join(root, safeRelative);
    if (!target.startsWith(root + sep)) continue;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
    written += 1;
  }
  return written;
}
