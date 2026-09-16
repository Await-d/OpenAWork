/**
 * 浏览器实时预览的 source map 解析器。
 *
 * 实时预览的 console / pageerror 事件携带的是 **生成后** 脚本里的调用点（CDP
 * `Runtime.CallFrame`），在 Vite / webpack dev server 下通常指向
 * `http://host:port/src/main.tsx` 或 `/assets/index-abc.js`。这些位置只有套用被服务脚本
 * 的 `//# sourceMappingURL` 才可读，因此本模块负责：
 *
 * 1. 抓取被服务的脚本，定位 inline（data: base64）或 external（相对脚本 URL 解析）
 *    形式的 source map；
 * 2. 用 Node 24 内置的 `module.SourceMap` 把 `{line, column}` 映射回原始位置；
 * 3. 返回 `sourcesContent` 支撑的原始源码文本。
 *
 * **零新增依赖**：只用 `node:module` 的 `SourceMap`（Node 24 提供），不引入任何第三方包。
 *
 * 坐标约定（与 CDP 对齐）：`RawStackFrame.line` / `column` 均为 **0-based**；本模块
 * 直接把该 0-based 位置喂给 `SourceMap.findEntry()`（其入参也是 0-based），并把返回的
 * `originalLine` / `originalColumn`（同样 0-based）写入 `sourceLine` / `sourceColumn`。
 * 不在此处做 1-based 转换，交由消费端按需展示。
 */

import { Buffer } from 'node:buffer';
import { SourceMap } from 'node:module';
import type { SourceMapPayload } from 'node:module';

/** 生成后脚本中的一个原始栈帧；`line` / `column` 均为 0-based（CDP 约定）。 */
export interface RawStackFrame {
  url: string;
  /** 0-based 行号，对齐 CDP `Runtime.CallFrame.lineNumber`。 */
  line: number;
  /** 0-based 列号，对齐 CDP `Runtime.CallFrame.columnNumber`。 */
  column: number;
  functionName?: string;
}

/**
 * 套用 source map 后的栈帧。
 *
 * - `line` / `column`：原始（生成后）位置，0-based，原样回传；
 * - `sourceLine` / `sourceColumn`：映射出的原始源码位置，0-based；
 * - `sourceName`：原始源码路径（map 的 `sources[i]`）；无法解析时为 `null`；
 * - `source`：该原始源码的 `sourcesContent` 文本；map 未内联源码时为 `null`；
 * - `mapped`：是否真正命中了一条映射。
 */
export interface ResolvedStackFrame {
  url: string;
  line: number;
  column: number;
  functionName?: string;
  source: string | null;
  sourceLine: number | null;
  sourceColumn: number | null;
  sourceName: string | null;
  mapped: boolean;
}

export interface ResolveStackFramesOptions {
  /** 测试注入用 fetch；缺省使用全局 `fetch`。 */
  fetchImpl?: typeof fetch;
  /** 只解析前 N 帧，默认 `DEFAULT_SOURCE_MAP_MAX_FRAMES`。 */
  maxFrames?: number;
  /** 单次网络抓取超时（毫秒），默认 `DEFAULT_SOURCE_MAP_TIMEOUT_MS`。 */
  timeoutMs?: number;
}

export const DEFAULT_SOURCE_MAP_MAX_FRAMES = 12;
export const DEFAULT_SOURCE_MAP_TIMEOUT_MS = 3_000;

/** 缓存的 source map 上限；超出按插入顺序淘汰最旧的一条。 */
export const SOURCE_MAP_CACHE_LIMIT = 32;

interface LoadedSourceMap {
  map: SourceMap;
  sources: string[];
  sourcesContent: Array<string | null>;
}

/**
 * 脚本 URL → 其 sourceMappingURL（已解析为绝对 URL 或 inline data URL）。
 * 用 Promise 缓存以合并同 URL 的并发抓取。
 */
const scriptMappingUrlCache = new Map<string, Promise<string | null>>();

/** sourceMappingURL → 构建好的 SourceMap；有界缓存（见 `SOURCE_MAP_CACHE_LIMIT`）。 */
const sourceMapCache = new Map<string, Promise<LoadedSourceMap | null>>();

/** 清空脚本 / source map 缓存（测试用）。 */
export function resetSourceMapCaches(): void {
  scriptMappingUrlCache.clear();
  sourceMapCache.clear();
}

/**
 * 把一批原始栈帧解析为源映射后的帧。
 *
 * 只处理 `http(s)` 帧（`data:` / `blob:` / `about:` / `chrome-*` / 扩展等一律跳过），
 * 且只解析前 `maxFrames` 帧。**永不抛错**：任何单帧失败都回退为 `mapped: false`。
 */
export async function resolveStackFrames(
  frames: RawStackFrame[],
  options: ResolveStackFramesOptions = {},
): Promise<ResolvedStackFrame[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxFrames = normalizePositiveInt(options.maxFrames, DEFAULT_SOURCE_MAP_MAX_FRAMES);
  const timeoutMs = normalizePositiveInt(options.timeoutMs, DEFAULT_SOURCE_MAP_TIMEOUT_MS);

  const limited = frames.slice(0, maxFrames);
  return await Promise.all(limited.map((frame) => resolveFrame(frame, fetchImpl, timeoutMs)));
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function buildBaseFrame(frame: RawStackFrame): ResolvedStackFrame {
  return {
    url: frame.url,
    line: frame.line,
    column: frame.column,
    ...(frame.functionName !== undefined ? { functionName: frame.functionName } : {}),
    source: null,
    sourceLine: null,
    sourceColumn: null,
    sourceName: null,
    mapped: false,
  };
}

function isResolvableUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

async function resolveFrame(
  frame: RawStackFrame,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<ResolvedStackFrame> {
  const base = buildBaseFrame(frame);
  if (!isResolvableUrl(frame.url)) {
    return base;
  }

  try {
    const mapUrl = await loadScriptMappingUrl(frame.url, fetchImpl, timeoutMs);
    if (mapUrl === null) {
      return base;
    }

    const loaded = await loadSourceMap(mapUrl, fetchImpl, timeoutMs);
    if (loaded === null) {
      return base;
    }

    // findEntry 入参为 0-based；命中失败返回空对象。
    const entry = loaded.map.findEntry(frame.line, frame.column);
    if (!('originalSource' in entry)) {
      return base;
    }

    const sourceIndex = loaded.sources.indexOf(entry.originalSource);
    const sourceContent = sourceIndex >= 0 ? (loaded.sourcesContent[sourceIndex] ?? null) : null;

    return {
      ...base,
      source: sourceContent,
      sourceLine: entry.originalLine,
      sourceColumn: entry.originalColumn,
      sourceName: entry.originalSource.length > 0 ? entry.originalSource : null,
      mapped: true,
    };
  } catch {
    return base;
  }
}

function loadScriptMappingUrl(
  scriptUrl: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<string | null> {
  const cached = scriptMappingUrlCache.get(scriptUrl);
  if (cached) {
    return cached;
  }

  const pending = (async (): Promise<string | null> => {
    const source = await fetchText(scriptUrl, fetchImpl, timeoutMs);
    if (source === null) {
      return null;
    }

    const mappingUrl = findSourceMappingUrl(source);
    if (mappingUrl === null) {
      return null;
    }
    if (mappingUrl.startsWith('data:')) {
      return mappingUrl;
    }

    try {
      // 外部 map 路径相对脚本 URL 解析。
      return new URL(mappingUrl, scriptUrl).toString();
    } catch {
      return null;
    }
  })();

  scriptMappingUrlCache.set(scriptUrl, pending);
  return pending;
}

function loadSourceMap(
  mapUrl: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<LoadedSourceMap | null> {
  const cached = sourceMapCache.get(mapUrl);
  if (cached) {
    return cached;
  }

  const pending = (async (): Promise<LoadedSourceMap | null> => {
    const raw = mapUrl.startsWith('data:')
      ? decodeInlineSourceMap(mapUrl)
      : await fetchText(mapUrl, fetchImpl, timeoutMs);
    if (raw === null) {
      return null;
    }
    return buildSourceMap(raw);
  })();

  sourceMapCache.set(mapUrl, pending);
  if (sourceMapCache.size > SOURCE_MAP_CACHE_LIMIT) {
    const oldest = sourceMapCache.keys().next();
    if (!oldest.done) {
      sourceMapCache.delete(oldest.value);
    }
  }
  return pending;
}

const SOURCE_MAPPING_URL_PATTERN = /[#@]\s*sourceMappingURL=([^\s'"]+)/;

function findSourceMappingUrl(source: string): string | null {
  const match = SOURCE_MAPPING_URL_PATTERN.exec(source);
  const url = match?.[1];
  if (url === undefined) {
    return null;
  }
  // `/*# sourceMappingURL=x.map */` 形式下最后一个 token 可能带上 `*/` 的 `*`。
  return url.replace(/\*+$/, '');
}

function decodeInlineSourceMap(dataUrl: string): string | null {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1) {
    return null;
  }
  const metadata = dataUrl.slice(0, commaIndex);
  const payload = dataUrl.slice(commaIndex + 1);
  try {
    if (metadata.includes('base64')) {
      return Buffer.from(payload, 'base64').toString('utf8');
    }
    return decodeURIComponent(payload);
  } catch {
    return null;
  }
}

function buildSourceMap(raw: string): LoadedSourceMap | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const mappings = record['mappings'];
  const sourcesRaw = record['sources'];
  if (typeof mappings !== 'string' || !Array.isArray(sourcesRaw)) {
    return null;
  }

  const sources = sourcesRaw.map((entry) => (typeof entry === 'string' ? entry : ''));
  const contentRaw = record['sourcesContent'];
  const sourcesContent = Array.isArray(contentRaw)
    ? contentRaw.map((entry) => (typeof entry === 'string' ? entry : null))
    : [];
  const namesRaw = record['names'];

  const payload: SourceMapPayload = {
    version: typeof record['version'] === 'number' ? record['version'] : 3,
    file: typeof record['file'] === 'string' ? record['file'] : '',
    sourceRoot: typeof record['sourceRoot'] === 'string' ? record['sourceRoot'] : '',
    sources,
    sourcesContent: sourcesContent.map((entry) => entry ?? ''),
    names: Array.isArray(namesRaw)
      ? namesRaw.map((entry) => (typeof entry === 'string' ? entry : ''))
      : [],
    mappings,
  };

  try {
    return { map: new SourceMap(payload), sources, sourcesContent };
  } catch {
    return null;
  }
}

async function fetchText(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<string | null> {
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return null;
  }
  if (!response.ok) {
    return null;
  }
  try {
    return await response.text();
  } catch {
    return null;
  }
}
