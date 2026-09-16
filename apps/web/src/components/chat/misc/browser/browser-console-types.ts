/**
 * 控制台 / 网络条目的数据类型。
 *
 * 单独成文件的原因：注入脚本会上报、宿主组件要归并、面板要渲染、格式化
 * 工具要读——四方都要用同一套形状，放在任一方都会造成环形依赖。
 */

import type { BrowserLiveConsolePayload } from '@openAwork/shared';

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'network';

/**
 * 调用栈帧类型直接取自 wire 载荷的元素类型。
 *
 * `@openAwork/shared` 的 barrel 目前只导出载荷整体、未单独导出帧类型，
 * 这里用索引访问派生，避免复制一份 CDP / source map 字段形状造成漂移。
 */
export type ConsoleStackFrame = NonNullable<BrowserLiveConsolePayload['stack']>[number];
export type ConsoleSourceMappedStackFrame = NonNullable<
  BrowserLiveConsolePayload['sourceMappedStack']
>[number];

/**
 * 一次网络请求/响应的结构化快照。
 *
 * 生命周期分三段上报（`request` → `response` → `body`），宿主按
 * `networkId` 归并成一条记录，因此除 `networkId` 外全部字段可选。
 */
export interface NetworkExchange {
  /** 注入脚本生成的一次请求唯一 id，用于把三段合并成一条记录。 */
  networkId: string;
  source: 'fetch' | 'xhr';
  method: string;
  url: string;
  /** CDP 上报的资源类型（`document` / `script` / `xhr` / `fetch` 等）；iframe 注入路径没有该字段。 */
  resourceType?: string;
  requestHeaders?: Record<string, string>;
  requestBody?: string;
  requestBodyTruncated?: boolean;
  status?: number;
  statusText?: string;
  ok?: boolean;
  durationMs?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  responseBodyTruncated?: boolean;
  /** 网络层失败（连接被拒 / CORS / abort）时的原因。 */
  errorMessage?: string;
  /** 请求已发出但响应尚未回来。 */
  pending?: boolean;
}

export interface ConsoleEntry {
  id: string;
  level: ConsoleLevel;
  message: string;
  timestamp: number;
  source?: string;
  /** CDP 原始调用栈帧；仅实时引擎路径在采集到栈时携带（行列 0-based）。 */
  stack?: ConsoleStackFrame[];
  /** 套用 dev server source map 后的调用栈；仅在携带 `stack` 时出现。 */
  sourceMappedStack?: ConsoleSourceMappedStackFrame[];
  /** `level === 'network'` 时携带的结构化请求/响应数据。 */
  network?: NetworkExchange;
}

/**
 * 注入脚本上报的网络事件载荷。所有字段都可能缺失——脚本按阶段分批发送，
 * 且对读取失败的响应体直接省略。
 */
export interface NetworkMessagePayload {
  networkId?: unknown;
  source?: unknown;
  method?: unknown;
  url?: unknown;
  requestHeaders?: unknown;
  requestBody?: unknown;
  requestBodyTruncated?: unknown;
  status?: unknown;
  statusText?: unknown;
  ok?: unknown;
  durationMs?: unknown;
  responseHeaders?: unknown;
  responseBody?: unknown;
  responseBodyTruncated?: unknown;
  errorMessage?: unknown;
}
