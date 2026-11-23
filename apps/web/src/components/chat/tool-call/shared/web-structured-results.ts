/**
 * webfetch 抓到的「结构化 API 响应」识别。
 *
 * 背景：GitHub 一类的 JSON 接口如果落到通用文本路径（`ExpandableOutput`），
 * 用户看到的是一坨被硬截断的 `"gists_url":"https://…` 碎片——既读不出内容，
 * 又占满视口。这里在进入文本路径之前先尝试识别出「结果条目」，命中后交给
 * `WebResultCards` 渲染成卡片，未命中则返回 null 让调用方回落到原有路径。
 *
 * 判定刻意保守：只有「条目名 + 强特征字段」同时具备才认，且数组内元素必须
 * *全部*可识别才算结果列表——宁可回落到原始文本，也不要把任意 JSON 误判成
 * 结果卡片而丢掉数据。
 */

/** 单条结果的来源形态。 */
export type WebResultItemKind = 'repo' | 'user' | 'record';

export interface WebResultItem {
  kind: WebResultItemKind;
  /** 归属者 / 组织名（repo 的 `owner.login`）。 */
  owner?: string;
  /** 条目标题：repo 为仓库名，user 为 login，record 为 title / name。 */
  title: string;
  url?: string;
  description?: string;
  /** 主语言（repo）。 */
  language?: string;
  stars?: number;
  forks?: number;
  /** 未关闭 issue 数（repo）。 */
  issues?: number;
  /** 公开仓库数（user）。 */
  repositoryCount?: number;
  /** 关注者数（user）。 */
  followers?: number;
}

export interface WebStructuredResults {
  items: WebResultItem[];
  /** 接口返回的总命中数（GitHub 搜索的 `total_count`）。 */
  totalCount?: number;
}

/** 最多渲染条数：再多也只是把视口填满，剩余量交给底部提示行交代。 */
const MAX_RESULT_ITEMS = 8;

/**
 * 尝试识别的最长正文。响应体积完全由被抓的站点决定，几十 MB 的 JSON 在这里
 * `JSON.parse` 一次就是一次掉帧，而那种响应本来也不该走卡片路径。
 */
const MAX_STRUCTURED_SCAN_CHARS = 512 * 1024;

/**
 * 从 webfetch 的响应正文里识别结构化结果。
 *
 * 支持三种形态：顶层数组、`{ total_count, items: [...] }` 搜索信封、
 * 单个资源对象（如 `/users/:login`、`/repos/:owner/:name`）。
 */
export function extractWebStructuredResults(content: string): WebStructuredResults | null {
  const trimmed = content.trim();
  // 快速否决：只有 JSON 容器开头、且体积可控时，才值得付 `JSON.parse` 的代价。
  if (trimmed.length > MAX_STRUCTURED_SCAN_CHARS) return null;
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }

  return resolveStructuredResults(parsed);
}

/**
 * 已经是结构化值时直接判定。
 *
 * 有些接口把数据直接放在响应体顶层（搜索信封 `{ query, results }`），根本没有
 * `content` / `output` 正文字段——调用方拿不到 JSON 文本，只能走这里，否则那条
 * 路径的结果列表永远识别不出来。
 */
export function extractWebStructuredResultsFromValue(value: unknown): WebStructuredResults | null {
  return resolveStructuredResults(value);
}

function resolveStructuredResults(parsed: unknown): WebStructuredResults | null {
  if (Array.isArray(parsed)) {
    const items = collectItems(parsed);
    return items.length > 0 ? { items } : null;
  }

  if (!isRecord(parsed)) return null;

  const rawItems = parsed['items'];
  if (Array.isArray(rawItems)) {
    const items = collectItems(rawItems);
    if (items.length === 0) return null;
    const totalCount = asFiniteNumber(parsed['total_count']);
    return totalCount === undefined ? { items } : { items, totalCount };
  }

  // 搜索引擎信封：`{ query, results: [...], totalResults }`。内置 `websearch` 与
  // 走 MCP 的 `open_websearch.search` / Exa 都落在这个形状上，认出来才能把
  // 「一条条标题 + 链接」渲染成结果列表，而不是把整个响应体当 JSON 铺开。
  const rawResults = parsed['results'];
  if (Array.isArray(rawResults)) {
    const items = collectItems(rawResults);
    if (items.length === 0) return null;
    const totalCount = asFiniteNumber(parsed['totalResults']) ?? asFiniteNumber(parsed['total']);
    return totalCount === undefined ? { items } : { items, totalCount };
  }

  const single = resolveItem(parsed);
  return single ? { items: [single] } : null;
}

/**
 * 折叠行上的「结果量」摘要：结构化条目优先（搜索接口带上命中总数），其次退到
 * 文本解析出的搜索结果条数；都没有则返回 undefined，该段不渲染。
 */
export function formatWebResultCount(
  results: WebStructuredResults | null,
  searchResultCount: number,
): string | undefined {
  if (results && results.items.length > 0) {
    const total = results.totalCount;
    const count = total ?? results.items.length;
    const prefix = total === undefined ? '' : '共 ';
    const kinds = new Set(results.items.map((item) => item.kind));
    if (kinds.size === 1) {
      const kind = results.items[0]?.kind;
      const unit = kind === 'repo' ? '个仓库' : kind === 'user' ? '个用户' : '条记录';
      return `${prefix}${count} ${unit}`;
    }
    return `${prefix}${count} 条记录`;
  }
  if (searchResultCount > 0) return `${searchResultCount} 条结果`;
  return undefined;
}

/**
 * 数组中**已校验的**元素必须全部可识别才算结果列表——出现一个认不出的就整组放弃，
 * 交给文本路径更安全（局部命中往往意味着这不是结果集，而是一段恰好以 `[` 开头的日志）。
 *
 * 校验只做到 `MAX_RESULT_ITEMS` 项就不再往下扫：尾部即便混入别的形状，前 N 项
 * 确实都是结果条目，渲染它们不会出错，无需为它付一次全量扫描的成本。
 */
function collectItems(values: unknown[]): WebResultItem[] {
  if (values.length === 0) return [];
  const items: WebResultItem[] = [];
  for (const value of values) {
    const item = resolveItem(value);
    if (!item) return [];
    items.push(item);
    if (items.length >= MAX_RESULT_ITEMS) break;
  }
  return items;
}

/** 仓库 → 用户 → 通用记录，按判别力从强到弱依次尝试。 */
function resolveItem(value: unknown): WebResultItem | null {
  if (!isRecord(value)) return null;
  return resolveRepo(value) ?? resolveUser(value) ?? resolveRecord(value);
}

/**
 * GitHub 仓库对象。强特征取 star / fork 计数——只有仓库才有这两个字段；
 * 缺失计数时退而要求 `full_name` + `owner.login` 同时存在。
 */
function resolveRepo(record: Record<string, unknown>): WebResultItem | null {
  const stars = asFiniteNumber(record['stargazers_count']);
  const forks = asFiniteNumber(record['forks_count']);
  const fullName = asText(record['full_name']);
  const ownerRecord = record['owner'];
  const owner = isRecord(ownerRecord) ? asText(ownerRecord['login']) : undefined;

  const hasCounters = stars !== undefined || forks !== undefined;
  if (!hasCounters && !(fullName && owner)) return null;

  const title = asText(record['name']) ?? lastPathSegment(fullName);
  if (!title) return null;

  const url = asUrl(record['html_url']);
  const language = asText(record['language']);
  const description = asText(record['description']);
  const issues = asFiniteNumber(record['open_issues_count']);

  return {
    kind: 'repo',
    title,
    ...(owner ? { owner } : {}),
    ...(url ? { url } : {}),
    ...(description ? { description } : {}),
    ...(language ? { language } : {}),
    ...(stars === undefined ? {} : { stars }),
    ...(forks === undefined ? {} : { forks }),
    ...(issues === undefined ? {} : { issues }),
  };
}

/**
 * GitHub 用户 / 组织对象。以 `login` 为前提，再要求至少一个身份特征字段，
 * 避免把其它带 `login` 字段的接口响应误认成用户。
 */
function resolveUser(record: Record<string, unknown>): WebResultItem | null {
  const login = asText(record['login']);
  if (!login) return null;

  const repositoryCount = asFiniteNumber(record['public_repos']);
  const followers = asFiniteNumber(record['followers']);
  const type = asText(record['type']);
  const url = asUrl(record['html_url']);
  const isUserLike =
    type === 'User' ||
    type === 'Organization' ||
    repositoryCount !== undefined ||
    followers !== undefined ||
    (asText(record['avatar_url']) !== undefined && url !== undefined);
  if (!isUserLike) return null;

  const description = asText(record['bio']) ?? asText(record['description']);
  return {
    kind: 'user',
    title: login,
    ...(url ? { url } : {}),
    ...(description ? { description } : {}),
    ...(repositoryCount === undefined ? {} : { repositoryCount }),
    ...(followers === undefined ? {} : { followers }),
  };
}

/**
 * 通用记录兜底（`title` / `name` + 链接或描述）。要求至少给得出链接或描述，
 * 否则与「任意恰好含 `name` 的 JSON 对象」无从区分，宁可放弃。
 */
function resolveRecord(record: Record<string, unknown>): WebResultItem | null {
  const title = asText(record['title']) ?? asText(record['name']);
  if (!title) return null;

  const url = asUrl(record['url']) ?? asUrl(record['html_url']) ?? asUrl(record['link']);
  const description =
    asText(record['description']) ?? asText(record['summary']) ?? asText(record['snippet']);
  if (!url && !description) return null;

  return {
    kind: 'record',
    title,
    ...(url ? { url } : {}),
    ...(description ? { description } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 非空字符串（去掉纯空白值，避免渲染出空标题 / 空描述）。 */
function asText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * 只接受 http / https —— 抓来的 JSON 完全由外部控制，`javascript:` 之类的
 * 协议一旦被渲染成链接就是可点击的注入点。
 */
function asUrl(value: unknown): string | undefined {
  const text = asText(value);
  if (!text) return undefined;
  try {
    const protocol = new URL(text).protocol;
    return protocol === 'http:' || protocol === 'https:' ? text : undefined;
  } catch {
    return undefined;
  }
}

function lastPathSegment(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const index = value.lastIndexOf('/');
  return index >= 0 ? value.slice(index + 1) : value;
}
