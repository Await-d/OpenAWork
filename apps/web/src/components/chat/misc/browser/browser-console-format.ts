/**
 * 控制台 / 网络条目的纯格式化逻辑。
 *
 * 面板要做的三件"复制"事——复制整条、复制请求、复制响应——都只是把结构化
 * 数据渲染成文本，与 React 无关，因此单独成模块，便于直接单测。
 */

import type {
  ConsoleEntry,
  NetworkExchange,
  NetworkMessagePayload,
} from './browser-console-types.js';

const TRUNCATED_SUFFIX = '\n…（内容已截断）';

/** 把 header 映射渲染成 `Key: value` 多行文本。 */
export function formatHeaderLines(headers: Record<string, string> | undefined): string {
  if (!headers) return '';
  const keys = Object.keys(headers);
  if (keys.length === 0) return '';
  return keys.map((key) => `${key}: ${headers[key] ?? ''}`).join('\n');
}

/**
 * 生成可直接在终端复现请求的 cURL 命令。
 *
 * body 里的单引号按 shell 规则转义（`'` → `'\''`），否则贴进终端会语法错误。
 */
export function buildCurlCommand(network: NetworkExchange): string {
  const parts: string[] = ['curl'];
  const method = (network.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    parts.push(`-X ${method}`);
  }
  parts.push(`'${network.url.replace(/'/g, `'\\''`)}'`);

  for (const [key, value] of Object.entries(network.requestHeaders ?? {})) {
    parts.push(`-H '${key}: ${value.replace(/'/g, `'\\''`)}'`);
  }
  if (network.requestBody) {
    parts.push(`--data-raw '${network.requestBody.replace(/'/g, `'\\''`)}'`);
  }
  return parts.join(' \\\n  ');
}

/** 请求侧文本：方法 + URL + 请求头 + 请求体。 */
export function formatNetworkRequestText(network: NetworkExchange): string {
  const lines: string[] = [`${(network.method || 'GET').toUpperCase()} ${network.url}`];
  const headers = formatHeaderLines(network.requestHeaders);
  if (headers) lines.push('', '请求头：', headers);
  if (network.requestBody) {
    lines.push(
      '',
      '请求体：',
      network.requestBody + (network.requestBodyTruncated ? TRUNCATED_SUFFIX : ''),
    );
  }
  return lines.join('\n');
}

/** 响应侧文本：状态码 + 耗时 + 响应头 + 响应体。 */
export function formatNetworkResponseText(network: NetworkExchange): string {
  const lines: string[] = [];
  if (network.errorMessage) {
    lines.push(`请求失败：${network.errorMessage}`);
  } else if (network.pending) {
    lines.push('请求尚未返回。');
  } else {
    const status = network.status ?? 0;
    const statusText = network.statusText ? ` ${network.statusText}` : '';
    const duration = network.durationMs === undefined ? '' : ` · ${network.durationMs}ms`;
    lines.push(`状态 ${status}${statusText}${duration}`);
  }
  const headers = formatHeaderLines(network.responseHeaders);
  if (headers) lines.push('', '响应头：', headers);
  if (network.responseBody) {
    lines.push(
      '',
      '响应体：',
      network.responseBody + (network.responseBodyTruncated ? TRUNCATED_SUFFIX : ''),
    );
  }
  return lines.join('\n');
}

/**
 * 列表里那一行的展示文案。
 *
 * 保留改造前用户已经熟悉的形状（`⟶` / `⟵` / `✗` 前缀），只是现在由结构化
 * 数据算出，而不是注入脚本硬拼字符串。
 */
export function formatNetworkEntryMessage(network: NetworkExchange): string {
  const call = `${(network.method || 'GET').toUpperCase()} ${network.url}`;
  if (network.errorMessage) {
    const duration = network.durationMs === undefined ? '' : ` · ${network.durationMs}ms`;
    return `✗ ${call}${duration} · ${network.errorMessage}`;
  }
  if (network.pending || network.status === undefined) {
    return `⟶ ${call}`;
  }
  const duration = network.durationMs === undefined ? '' : ` · ${network.durationMs}ms`;
  return `⟵ ${network.status} ${call}${duration}`;
}

/** 复制整条记录时的文本：网络记录带上请求/响应全文，普通日志就是原文。 */
export function formatEntryText(entry: ConsoleEntry): string {
  if (entry.level !== 'network' || !entry.network) {
    const time = new Date(entry.timestamp).toISOString();
    return `[${time}] [${entry.level}] ${entry.message}`;
  }
  const time = new Date(entry.timestamp).toISOString();
  return [
    `[${time}] [network] ${entry.message}`,
    '',
    '# 请求',
    formatNetworkRequestText(entry.network),
    '',
    '# 响应',
    formatNetworkResponseText(entry.network),
  ].join('\n');
}

/** 引用到输入框时的文本：给 LLM 看的，去掉噪声、保留可行动信息。 */
export function formatEntryForComposer(entry: ConsoleEntry): string {
  if (entry.level !== 'network' || !entry.network) {
    return `控制台 ${entry.level}：${entry.message}`;
  }
  const network = entry.network;
  const lines = [`网络请求 ${(network.method || 'GET').toUpperCase()} ${network.url}`];
  lines.push(network.pending ? '状态：请求中' : `状态：${network.status ?? 0}`);
  if (network.requestBody) lines.push(`请求体：${network.requestBody}`);
  if (network.responseBody) lines.push(`响应体：${network.responseBody}`);
  if (network.errorMessage) lines.push(`错误：${network.errorMessage}`);
  return lines.join('\n');
}

/**
 * 把注入脚本上报的字段解析成 `NetworkExchange`。
 *
 * 脚本运行在被控页面里，字段类型不可信（用户代码可能 monkey-patch 掉
 * fetch 后伪造 postMessage），所以逐字段做类型校验，不合法的直接丢弃。
 */
export function parseNetworkPayload(payload: NetworkMessagePayload): NetworkExchange | null {
  const networkId = typeof payload.networkId === 'string' ? payload.networkId : '';
  if (networkId.length === 0) return null;
  const url = typeof payload.url === 'string' ? payload.url : '';
  if (url.length === 0) return null;

  const exchange: NetworkExchange = {
    networkId,
    source: payload.source === 'xhr' ? 'xhr' : 'fetch',
    method: typeof payload.method === 'string' && payload.method ? payload.method : 'GET',
    url,
  };

  const requestHeaders = toHeaderRecord(payload.requestHeaders);
  if (requestHeaders) exchange.requestHeaders = requestHeaders;
  if (typeof payload.requestBody === 'string' && payload.requestBody.length > 0) {
    exchange.requestBody = payload.requestBody;
    if (payload.requestBodyTruncated === true) exchange.requestBodyTruncated = true;
  }

  if (typeof payload.status === 'number') exchange.status = payload.status;
  if (typeof payload.statusText === 'string') exchange.statusText = payload.statusText;
  if (typeof payload.ok === 'boolean') exchange.ok = payload.ok;
  if (typeof payload.durationMs === 'number') exchange.durationMs = payload.durationMs;

  const responseHeaders = toHeaderRecord(payload.responseHeaders);
  if (responseHeaders) exchange.responseHeaders = responseHeaders;
  if (typeof payload.responseBody === 'string' && payload.responseBody.length > 0) {
    exchange.responseBody = payload.responseBody;
    if (payload.responseBodyTruncated === true) exchange.responseBodyTruncated = true;
  }
  if (typeof payload.errorMessage === 'string' && payload.errorMessage.length > 0) {
    exchange.errorMessage = payload.errorMessage;
  }

  return exchange;
}

/**
 * 该上报是否代表「请求已发出、响应还没回来」。
 *
 * 注意响应体阶段同样不带 `status`（先发状态、再异步读体），所以必须把
 * `responseBody` 也算作"响应已回来的信号"，否则 body 到达时会把一条已完成
 * 的请求打回 pending。
 */
export function isPendingNetworkPayload(payload: NetworkMessagePayload): boolean {
  return (
    payload.status === undefined &&
    payload.errorMessage === undefined &&
    payload.responseBody === undefined
  );
}

function toHeaderRecord(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string') result[key] = raw;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * 把阶段补丁归并进已有记录。
 *
 * 逐字段合并而不是对象展开：响应阶段上报里不带请求头/请求体，用展开会把
 * 它们覆盖成 `undefined`，用户刚复制到的请求参数就没了。合并后重算展示文案。
 */
export function mergeNetworkIntoEntry(
  existing: ConsoleEntry,
  patch: NetworkExchange,
): ConsoleEntry {
  const merged: NetworkExchange = {
    ...(existing.network ?? {
      networkId: patch.networkId,
      source: patch.source,
      method: patch.method,
      url: patch.url,
    }),
  };

  if (patch.resourceType !== undefined) merged.resourceType = patch.resourceType;
  if (patch.requestHeaders) merged.requestHeaders = patch.requestHeaders;
  if (patch.requestBody) merged.requestBody = patch.requestBody;
  if (patch.requestBodyTruncated) merged.requestBodyTruncated = true;
  if (patch.status !== undefined) merged.status = patch.status;
  if (patch.statusText !== undefined) merged.statusText = patch.statusText;
  if (patch.ok !== undefined) merged.ok = patch.ok;
  if (patch.durationMs !== undefined) merged.durationMs = patch.durationMs;
  if (patch.responseHeaders) merged.responseHeaders = patch.responseHeaders;
  if (patch.responseBody) merged.responseBody = patch.responseBody;
  if (patch.responseBodyTruncated) merged.responseBodyTruncated = true;
  if (patch.errorMessage) merged.errorMessage = patch.errorMessage;
  if (patch.pending) merged.pending = true;

  // 响应已回来就不该再显示"请求中"。
  if (merged.status !== undefined || merged.errorMessage !== undefined) {
    delete merged.pending;
  }

  return {
    ...existing,
    network: merged,
    message: formatNetworkEntryMessage(merged),
  };
}
