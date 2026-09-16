/**
 * CDP 实时引擎（`/browser-live`）下行事件 → 现有控制台模型的纯映射层。
 *
 * 实时通道的载荷形状（`BrowserLiveConsolePayload` / `BrowserLiveNetworkPayload`）
 * 与 iframe 注入脚本的上报（`NetworkMessagePayload`）并不相同，但两者最终都要落进
 * 同一套 `ConsoleEntry` / `NetworkExchange`——控制台面板、错误摘要、composer 引用
 * 只认这套模型。把映射收在这里，消费端不需要知道数据来自哪种引擎。
 *
 * 网络三段归并复用 `upsertNetworkEntry`：它同样服务于 `BuiltInBrowser` 里的注入
 * 脚本上报路径，两条来源因此不会出现「一边合并、一边拆行」的漂移。
 */

import type {
  BrowserLiveNetworkPayload,
  BrowserLiveNodePayload,
} from '@openAwork/shared';

import { formatNetworkEntryMessage, mergeNetworkIntoEntry } from './browser-console-format.js';
import type {
  ConsoleEntry,
  ConsoleLevel,
  ConsoleSourceMappedStackFrame,
  ConsoleStackFrame,
  NetworkExchange,
} from './browser-console-types.js';

/**
 * 实时控制台载荷。字段按不可信处理（wire 数据可能带 `warning` 这类面板不认识的
 * 级别），因此这里用宽松结构而不是共享联合类型。
 */
export interface LiveConsolePayloadLike {
  level?: string;
  text?: string;
  timestamp?: number;
  /** CDP 原始栈帧；非数组 / 空数组视同缺省。 */
  stack?: readonly ConsoleStackFrame[];
  /** source map 解析后的栈；非数组 / 空数组视同缺省。 */
  sourceMappedStack?: readonly ConsoleSourceMappedStackFrame[];
}

/** 页面异常（`ch: 'error'`）的载荷；同样按不可信处理。 */
export interface LiveErrorPayloadLike {
  code?: string;
  message?: string;
  stack?: readonly ConsoleStackFrame[];
  sourceMappedStack?: readonly ConsoleSourceMappedStackFrame[];
}

/** 新建网络行的 id 前缀，与注入脚本上报保持同一形状。 */
const NETWORK_ENTRY_ID_PREFIX = 'net-';

/** 新建实时控制台行的 id 前缀。 */
const LIVE_CONSOLE_ID_PREFIX = 'live-console-';

/** 新建页面异常行的 id 前缀（与改造前 wiring 内联实现一致）。 */
const LIVE_ERROR_ID_PREFIX = 'live-error-';

/** 节点文本 / 属性值的展示上限，避免把整页文本塞进 composer。 */
const NODE_TEXT_MAX_CHARS = 240;
const NODE_ATTRIBUTE_MAX_CHARS = 120;

/** 整个引用块的字符上限；超出后按行截断，保证 composer 不被撑爆。 */
const NODE_BLOCK_MAX_CHARS = 1600;

/** 拾取结果的属性白名单（固定顺序输出；缺失 / 为空的键直接跳过）。 */
const NODE_ATTRIBUTE_KEYS = [
  'data-testid',
  'id',
  'role',
  'aria-label',
  'name',
  'type',
  'class',
  'title',
] as const;

/**
 * 拾取结果的计算样式白名单（固定顺序输出，便于稳定断言与阅读）。
 *
 * 计算样式动辄 400+ 条、且随浏览器版本漂移，裸 dump 会直接撑爆上下文。
 */
const NODE_STYLE_KEYS = [
  'display',
  'position',
  'width',
  'height',
  'color',
  'background-color',
  'font-size',
  'font-weight',
  'margin',
  'padding',
  'border-radius',
  'z-index',
  'opacity',
  'visibility',
  'overflow',
] as const;

/** 白名单样式里的「默认值」——每页必有、对 agent 零信息量，静默跳过。 */
const NODE_STYLE_DEFAULT_VALUES: Record<string, readonly string[]> = {
  'z-index': ['auto'],
  opacity: ['1'],
  visibility: ['visible'],
  overflow: ['visible'],
};

/**
 * CDP 控制台 level → 面板 level。
 *
 * CDP 侧可能给出 `warning` / `trace` 这类别名，统一归一到面板的五个级别；
 * 未知值按 `log` 处理，宁可少报也不让面板出现不认识的级别。
 */
export function mapLiveConsoleLevel(level: string | undefined): ConsoleLevel {
  switch (level) {
    case 'info':
      return 'info';
    case 'warn':
    case 'warning':
      return 'warn';
    case 'error':
      return 'error';
    case 'debug':
    case 'trace':
    case 'verbose':
      return 'debug';
    default:
      return 'log';
  }
}

/**
 * 一条实时控制台日志 → `ConsoleEntry`。
 *
 * `sequence` 由调用方持有（每个面板一个计数器），据此生成稳定且唯一的 id；
 * 载荷自带时间戳且合法时优先使用，否则回落到 `now`。
 */
export function consolePayloadToEntry(
  payload: LiveConsolePayloadLike,
  sequence: number,
  now: number,
): ConsoleEntry {
  const { timestamp } = payload;
  const usableTimestamp =
    typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0
      ? timestamp
      : now;

  const entry: ConsoleEntry = {
    id: `${LIVE_CONSOLE_ID_PREFIX}${sequence}`,
    level: mapLiveConsoleLevel(payload.level),
    message: typeof payload.text === 'string' ? payload.text : '',
    timestamp: usableTimestamp,
  };
  attachStack(entry, payload);
  return entry;
}

/**
 * 一条页面异常（`ch: 'error'`）→ `ConsoleEntry`。
 *
 * 与 `consolePayloadToEntry` 同样保留可选栈（未捕获异常的栈同样值得展开查看）；
 * 文案规则与改造前 wiring 内联实现保持一致，code 缺省时用兜底码。
 */
export function errorPayloadToEntry(
  payload: LiveErrorPayloadLike | undefined | null,
  sequence: number,
  now: number,
): ConsoleEntry {
  const code = typeof payload?.code === 'string' ? payload.code : 'browser_live_error';
  const message = typeof payload?.message === 'string' ? payload.message : '';

  const entry: ConsoleEntry = {
    id: `${LIVE_ERROR_ID_PREFIX}${sequence}`,
    level: 'error',
    message: message.length > 0 ? `${code}: ${message}` : code,
    timestamp: now,
  };
  attachStack(entry, payload ?? {});
  return entry;
}

/** 把非空 `stack` / `sourceMappedStack` 数组挂到条目上；缺省或空数组不产生字段。 */
function attachStack(
  entry: ConsoleEntry,
  payload: Pick<LiveConsolePayloadLike, 'stack' | 'sourceMappedStack'>,
): void {
  if (Array.isArray(payload.stack) && payload.stack.length > 0) {
    entry.stack = [...payload.stack];
  }
  if (Array.isArray(payload.sourceMappedStack) && payload.sourceMappedStack.length > 0) {
    entry.sourceMappedStack = [...payload.sourceMappedStack];
  }
}

/**
 * 一段实时网络上报 → `NetworkExchange` 阶段补丁。
 *
 * 只带上本阶段真实出现的字段：`mergeNetworkIntoEntry` 逐字段合并，缺字段不会把
 * 先到的请求头/请求体覆盖成 `undefined`。`request` 阶段标记 `pending`，响应或失败
 * 到达时由合并逻辑清掉。
 */
export function networkPayloadToExchange(payload: BrowserLiveNetworkPayload): NetworkExchange {
  const exchange: NetworkExchange = {
    networkId: typeof payload.requestId === 'string' ? payload.requestId : '',
    source: 'fetch',
    method: typeof payload.method === 'string' && payload.method.length > 0 ? payload.method : 'GET',
    url: typeof payload.url === 'string' ? payload.url : '',
  };

  if (typeof payload.resourceType === 'string' && payload.resourceType.length > 0) {
    exchange.resourceType = payload.resourceType;
  }
  if (payload.requestHeadersSanitized) {
    exchange.requestHeaders = { ...payload.requestHeadersSanitized };
  }
  if (payload.responseHeadersSanitized) {
    exchange.responseHeaders = { ...payload.responseHeadersSanitized };
  }
  if (typeof payload.status === 'number') {
    exchange.status = payload.status;
    exchange.ok = payload.status < 400;
  }
  if (typeof payload.statusText === 'string' && payload.statusText.length > 0) {
    exchange.statusText = payload.statusText;
  }
  if (typeof payload.durationMs === 'number') {
    exchange.durationMs = payload.durationMs;
  }
  if (payload.phase === 'failed' && typeof payload.errorText === 'string') {
    exchange.errorMessage = payload.errorText;
  }
  if (payload.phase !== 'response' && payload.phase !== 'failed') {
    exchange.pending = true;
  }

  return exchange;
}

export interface UpsertNetworkEntryOptions {
  /** 新建行的 timestamp。 */
  now: number;
  /** 新建行前保留的最近条目数（与 iframe 路径的 CONSOLE_ENTRY_LIMIT 语义一致）。 */
  limit?: number;
}

/**
 * 把一段网络阶段补丁并进条目列表：同一 `networkId` 始终落在同一行。
 *
 * 与 `BuiltInBrowser` 处理注入脚本上报时是同一段语义（request → response →
 * failed），实时通道因此可以复用同一条行内归并规则。列表里没有该请求时新建一行，
 * 用 `formatNetworkEntryMessage` 生成与 iframe 路径完全一致的展示文案。
 */
export function upsertNetworkEntry(
  entries: ConsoleEntry[],
  patch: NetworkExchange,
  options: UpsertNetworkEntryOptions,
): ConsoleEntry[] {
  const index = entries.findIndex((entry) => entry.network?.networkId === patch.networkId);
  if (index >= 0) {
    return entries.map((entry, i) => (i === index ? mergeNetworkIntoEntry(entry, patch) : entry));
  }

  const base =
    options.limit === undefined || options.limit <= 0
      ? entries
      : entries.slice(-options.limit);

  return [
    ...base,
    {
      id: `${NETWORK_ENTRY_ID_PREFIX}${patch.networkId}`,
      level: 'network',
      message: formatNetworkEntryMessage(patch),
      timestamp: options.now,
      network: patch,
    },
  ];
}

/**
 * 元素拾取结果 → composer markdown 块。
 *
 * 形状对 LLM 友好且克制：选择器（含推导策略）/ 标签 / 文本 / 白名单属性 /
 * 白名单样式各占一行，值统一压成单行并截断。输出不含时间戳等易变字段——同一
 * payload 永远得到同一段文本，便于 diff 与断言。
 */
export function nodePayloadToMarkdown(payload: BrowserLiveNodePayload): string {
  const selector = flattenInline(payload.selector, NODE_ATTRIBUTE_MAX_CHARS);
  const lines: string[] = [`### 元素拾取 \`${selector}\``];

  if (payload.selectorUnique === false) {
    lines.push('- ⚠️ 该选择器可能不唯一：命中多个元素，引用前请确认。');
  }

  const strategy = flattenInline(payload.selectorStrategy ?? '', NODE_ATTRIBUTE_MAX_CHARS);
  if (strategy.length > 0) {
    lines.push(`- 选择器来源：\`${strategy}\``);
  }

  const nodeName = flattenInline(payload.nodeName, NODE_ATTRIBUTE_MAX_CHARS);
  if (nodeName.length > 0) {
    lines.push(`- 标签：\`${nodeName}\``);
  }

  const text = flattenInline(payload.text, NODE_TEXT_MAX_CHARS);
  if (text.length > 0) {
    lines.push(`- 文本：${text}`);
  }

  const attributes = collectAttributes(payload.attributes ?? {});
  if (attributes.length > 0) {
    lines.push('- 属性：');
    for (const [name, value] of attributes) {
      lines.push(`  - \`${name}\` = \`${value}\``);
    }
  }

  const styles = collectKeyStyles(payload.computedStyles ?? {});
  if (styles.length > 0) {
    lines.push('- 关键样式：');
    for (const style of styles) {
      lines.push(`  - \`${style}\``);
    }
  }

  return capBlock(lines, NODE_BLOCK_MAX_CHARS);
}

/** 按固定白名单摘出属性，输出 `[name, value]`（白名单外的键一律不落进 composer）。 */
function collectAttributes(attributes: Record<string, string>): Array<[string, string]> {
  const result: Array<[string, string]> = [];
  for (const key of NODE_ATTRIBUTE_KEYS) {
    const value = attributes[key];
    if (typeof value !== 'string') continue;
    const flat = flattenInline(value, NODE_ATTRIBUTE_MAX_CHARS);
    if (flat.length === 0) continue;
    result.push([key, flat]);
  }
  return result;
}

/** 按固定白名单摘出关键样式，输出 `key: value`（缺失的键直接跳过）。 */
function collectKeyStyles(computedStyles: Record<string, string>): string[] {
  const result: string[] = [];
  for (const key of NODE_STYLE_KEYS) {
    const value = computedStyles[key];
    if (typeof value !== 'string') continue;
    const flat = flattenInline(value, NODE_ATTRIBUTE_MAX_CHARS);
    if (flat.length === 0 || flat === 'none' || flat === 'normal') continue;
    if (NODE_STYLE_DEFAULT_VALUES[key]?.includes(flat) === true) continue;
    result.push(`${key}: ${flat}`);
  }
  return result;
}

/** 逐行累计到上限为止；发生截断时追加显式说明，避免静默丢信息。 */
function capBlock(lines: string[], maxChars: number): string {
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    const cost = line.length + 1;
    if (used + cost > maxChars) {
      kept.push('- …（引用内容过长，已截断）');
      break;
    }
    kept.push(line);
    used += cost;
  }
  return kept.join('\n');
}

/** 压平换行/空白、转义反引号，并截断到 `maxChars` 以内。 */
function flattenInline(value: string, maxChars: number): string {
  if (typeof value !== 'string') return '';
  const flat = value.replace(/\s+/g, ' ').trim().replace(/`/g, "'");
  if (flat.length <= maxChars) return flat;
  if (maxChars <= 1) return '…';
  return `${flat.slice(0, maxChars - 1)}…`;
}
