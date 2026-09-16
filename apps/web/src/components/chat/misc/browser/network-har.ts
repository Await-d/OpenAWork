/**
 * 网络记录 → HAR 1.2 导出。
 *
 * 数据源是与列表 / 瀑布视图完全同源的 `NetworkExchange`，本模块只做「结构化快照
 * → HAR」的纯映射：不读时钟、不碰 DOM（下载函数除外），相同输入必然产出逐字节
 * 相同的输出，便于单测与问题复现。
 *
 * 本阶段只采集请求 / 响应元数据，因此绝不伪造未采集的内容：
 * - `httpVersion` 用空串占位，而不是编造 `HTTP/1.1`；
 * - `headersSize` / `bodySize` / 未采集的分段耗时统一写 `-1`（HAR 规范的未知值）；
 * - `timings.wait` 取自 `durationMs`——CDP 只给总耗时，没有 blocked/dns/connect 细分；
 * - 响应体没有采集：`content` 只带 mimeType 并显式标记 `_bodyNotCaptured: true`；
 * - 失败请求照实写 `response.status: 0` 并把 `errorMessage` 落到 `response._error`。
 *
 * `_` 前缀字段是 HAR 规范允许的扩展位（"Custom fields"）。
 */

import type { NetworkExchange } from './browser-console-types.js';

/** HAR 1.2 版本号。 */
const HAR_VERSION = '1.2' as const;

/** 未采集 / 未知数值的 HAR 约定值。 */
const UNKNOWN = -1;

/** 未采集 HTTP 版本时的占位。 */
const HTTP_VERSION_UNAVAILABLE = '';

/** 单页采集的固定 page id（本阶段一次导出只对应一个页面）。 */
const PAGE_ID = 'page_0';

const DEFAULT_CREATOR_NAME = 'OpenAWork';
const DEFAULT_CREATOR_VERSION = '1.0';

/** 输入没有任何开始时刻时的回退时间（epoch），保证输出可复现。 */
const EPOCH_MS = 0;

/** 导出上下文：采集的页面信息与导出工具标识。 */
export interface NetworkHarContext {
  /** 采集页面 URL；`title` 缺失时作为 page 标题回退。 */
  url?: string | null;
  /** 采集页面标题。 */
  title?: string | null;
  /** 导出工具名（`creator.name`）。 */
  creatorName?: string;
  /** 导出工具版本（`creator.version`）。 */
  creatorVersion?: string;
}

/**
 * HAR 构建的输入记录：既有 `NetworkExchange` + 该请求的开始时刻。
 *
 * 为什么不直接把时刻塞进 `NetworkExchange`：开始时刻是宿主侧的采集事实
 * （`ConsoleEntry.timestamp`），归并层（`upsertNetwork` / `mergeNetworkIntoEntry`）
 * 并不需要它。普通 `NetworkExchange[]` 依旧满足本类型（字段可选），
 * 调用方可以不带时刻地构建，只是 `startedDateTime` 会回退到 epoch。
 */
export interface HarExchange extends NetworkExchange {
  /** 请求阶段到达宿主的时刻（epoch ms）。缺失时 `startedDateTime` 回退到 epoch。 */
  startedAtMs?: number;
}

export interface HarCreator {
  name: string;
  version: string;
}

export interface HarPageTimings {
  onContentLoad: number;
  onLoad: number;
}

export interface HarPage {
  startedDateTime: string;
  id: string;
  title: string;
  pageTimings: HarPageTimings;
}

export interface HarHeader {
  name: string;
  value: string;
}

export interface HarQueryString {
  name: string;
  value: string;
}

export interface HarCookie {
  name: string;
  value: string;
}

export interface HarPostData {
  mimeType: string;
  text: string;
  /** 请求体在上游被截断时的标记（`_` 前缀为 HAR 允许的自定义字段）。 */
  _truncated?: boolean;
}

export interface HarRequest {
  method: string;
  url: string;
  httpVersion: string;
  cookies: HarCookie[];
  headers: HarHeader[];
  queryString: HarQueryString[];
  postData?: HarPostData;
  headersSize: number;
  bodySize: number;
}

export interface HarContent {
  size: number;
  mimeType: string;
  /** 响应体未采集（本阶段只有元数据）。 */
  _bodyNotCaptured: true;
}

export interface HarResponse {
  status: number;
  statusText: string;
  httpVersion: string;
  cookies: HarCookie[];
  headers: HarHeader[];
  content: HarContent;
  redirectURL: string;
  headersSize: number;
  bodySize: number;
  /** 网络层失败原因（自定义字段）；仅失败请求携带。 */
  _error?: string;
}

export interface HarTimings {
  blocked: number;
  dns: number;
  connect: number;
  send: number;
  wait: number;
  receive: number;
}

export interface HarEntry {
  pageref: string;
  startedDateTime: string;
  time: number;
  request: HarRequest;
  response: HarResponse;
  cache: Record<string, never>;
  timings: HarTimings;
}

export interface HarLog {
  log: {
    version: typeof HAR_VERSION;
    creator: HarCreator;
    pages: HarPage[];
    entries: HarEntry[];
  };
}

/**
 * 把一串网络记录构建成 HAR 1.2 文档。
 *
 * 输入顺序即输出顺序（宿主按到达顺序存放条目，天然是时间序）；不会重新排序，
 * 保证「同一份记录 → 同一份文件」。
 */
export function buildNetworkHar(
  exchanges: readonly HarExchange[],
  context: NetworkHarContext = {},
): HarLog {
  const page: HarPage = {
    startedDateTime: toIsoString(earliestStart(exchanges)),
    id: PAGE_ID,
    title: normalizeText(context.title) ?? normalizeText(context.url) ?? '',
    // 页面级 onContentLoad / onLoad 没有采集：写未知值而不是编造耗时。
    pageTimings: { onContentLoad: UNKNOWN, onLoad: UNKNOWN },
  };

  return {
    log: {
      version: HAR_VERSION,
      creator: {
        name: normalizeText(context.creatorName) ?? DEFAULT_CREATOR_NAME,
        version: normalizeText(context.creatorVersion) ?? DEFAULT_CREATOR_VERSION,
      },
      pages: [page],
      entries: exchanges.map((exchange) => toHarEntry(exchange)),
    },
  };
}

/** 触发一次客户端 Blob 下载；不发任何网关请求。无 DOM / 不支持 Blob URL 时静默放弃。 */
export function downloadNetworkHar(har: HarLog, fileName: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  if (typeof URL.createObjectURL !== 'function') return;

  const blob = new Blob([JSON.stringify(har, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  if (typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(objectUrl);
  }
}

// ── 逐字段映射 ──────────────────────────────────────────────────────────

function toHarEntry(exchange: HarExchange): HarEntry {
  const duration = normalizeDuration(exchange.durationMs);
  const requestHeaders = toHarHeaders(exchange.requestHeaders);
  const responseHeaders = toHarHeaders(exchange.responseHeaders);

  return {
    pageref: PAGE_ID,
    startedDateTime: toIsoString(normalizeStart(exchange.startedAtMs) ?? EPOCH_MS),
    // 总耗时就是 durationMs；没有更细分段，未知时写 -1。
    time: duration ?? UNKNOWN,
    request: toHarRequest(exchange, requestHeaders),
    response: toHarResponse(exchange, responseHeaders),
    cache: {},
    timings: {
      blocked: UNKNOWN,
      dns: UNKNOWN,
      connect: UNKNOWN,
      send: UNKNOWN,
      wait: duration ?? UNKNOWN,
      receive: UNKNOWN,
    },
  };
}

function toHarRequest(exchange: HarExchange, headers: HarHeader[]): HarRequest {
  const request: HarRequest = {
    method: normalizeMethod(exchange.method),
    url: exchange.url,
    httpVersion: HTTP_VERSION_UNAVAILABLE,
    cookies: [],
    headers,
    queryString: parseQueryString(exchange.url),
    headersSize: UNKNOWN,
    bodySize: UNKNOWN,
  };

  if (typeof exchange.requestBody === 'string' && exchange.requestBody.length > 0) {
    request.postData = {
      mimeType: findHeaderValue(headers, 'content-type') ?? '',
      text: exchange.requestBody,
      ...(exchange.requestBodyTruncated === true ? { _truncated: true } : {}),
    };
    request.bodySize = exchange.requestBody.length;
  }

  return request;
}

function toHarResponse(exchange: HarExchange, headers: HarHeader[]): HarResponse {
  const status = typeof exchange.status === 'number' ? exchange.status : 0;
  const response: HarResponse = {
    status,
    statusText: typeof exchange.statusText === 'string' ? exchange.statusText : '',
    httpVersion: HTTP_VERSION_UNAVAILABLE,
    cookies: [],
    headers,
    content: {
      size: UNKNOWN,
      mimeType: findHeaderValue(headers, 'content-type') ?? '',
      _bodyNotCaptured: true,
    },
    redirectURL: deriveRedirectUrl(status, headers),
    headersSize: UNKNOWN,
    bodySize: UNKNOWN,
  };

  if (typeof exchange.errorMessage === 'string' && exchange.errorMessage.length > 0) {
    response._error = exchange.errorMessage;
  }

  return response;
}

/** 头部记录 → HAR 数组；保持上游（已脱敏）的键顺序，绝不改写值。 */
function toHarHeaders(headers: Record<string, string> | undefined): HarHeader[] {
  if (headers === undefined) return [];
  const result: HarHeader[] = [];
  for (const [name, value] of Object.entries(headers)) {
    result.push({ name, value });
  }
  return result;
}

function findHeaderValue(headers: readonly HarHeader[], name: string): string | undefined {
  const target = name.toLowerCase();
  for (const header of headers) {
    if (header.name.toLowerCase() === target) return header.value;
  }
  return undefined;
}

function deriveRedirectUrl(status: number, headers: readonly HarHeader[]): string {
  if (status < 300 || status >= 400) return '';
  return findHeaderValue(headers, 'location') ?? '';
}

/**
 * URL → queryString 数组。
 *
 * 不用 `new URL()`：它要求绝对 URL，而注入脚本/相对资源可能上报相对地址，
 * 解析失败不应让整份导出崩掉。这里只做字符串切分，非法百分号转义由
 * `URLSearchParams` 按规范容错（不会抛错）。
 */
function parseQueryString(url: string): HarQueryString[] {
  const queryIndex = url.indexOf('?');
  if (queryIndex < 0) return [];
  const hashIndex = url.indexOf('#');
  if (hashIndex >= 0 && hashIndex < queryIndex) return [];
  const query = url.slice(queryIndex + 1, hashIndex < 0 ? undefined : hashIndex);
  if (query.length === 0) return [];

  const result: HarQueryString[] = [];
  for (const [name, value] of new URLSearchParams(query)) {
    result.push({ name, value });
  }
  return result;
}

/** 单页采集下最早出现的开始时刻；没有任何记录时回退 epoch。 */
function earliestStart(exchanges: readonly HarExchange[]): number {
  let earliest = Number.POSITIVE_INFINITY;
  for (const exchange of exchanges) {
    const startedAt = normalizeStart(exchange.startedAtMs);
    if (startedAt !== undefined && startedAt < earliest) earliest = startedAt;
  }
  return Number.isFinite(earliest) ? earliest : EPOCH_MS;
}

function normalizeStart(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** 耗时合法（有限且非负）时原样返回，否则视为未采集。 */
function normalizeDuration(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function normalizeMethod(value: string): string {
  return value.length > 0 ? value.toUpperCase() : 'GET';
}

/** 日期非法（超出 Date 范围等）时回退 epoch，而不是让导出抛错。 */
function toIsoString(ms: number): string {
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? new Date(EPOCH_MS).toISOString() : date.toISOString();
}

/** 空串 / 纯空白视为未提供。 */
function normalizeText(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
