/**
 * 通用流式 HTTP(S) 下载助手（基于 `node:http` / `node:https`）。
 *
 * 使用场景：网关需要在运行时下载大体积安装包（例如 Playwright 浏览器，约 150MB），
 * 且必须支持经代理 Agent 出网。全局 `fetch` / undici 无法直接挂接 `http.Agent`，
 * 因此这里直接用 Node 原生 `http.get` / `https.get` 实现：
 *
 * - 手动跟随 301/302/303/307/308（`location` 支持相对路径），每一跳重新解析代理；
 * - 边下边写盘，进度按 ~250ms 节流上报（首字节与完成时强制上报）；
 * - 空闲超时（默认 60s，收到数据自动重置）与 `AbortSignal` 取消；
 * - 任何失败都会删除目标文件，避免半成品残留；
 * - 服务端声明 `content-length` 时校验实际接收字节数。
 *
 * 设计边界：本模块只负责「把一个 URL 流式下载到本地文件」，不包含镜像选择、
 * revision 映射或浏览器知识——那些属于调用方。
 */

import { createWriteStream, type WriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import http, {
  type Agent,
  type ClientRequest,
  type IncomingMessage,
  type RequestOptions,
} from 'node:http';
import https from 'node:https';
import { pipeline } from 'node:stream/promises';

/** 单次下载的进度快照。 */
export interface DownloadProgress {
  /** 已接收字节数。 */
  receivedBytes: number;
  /** 服务端声明的总字节数；无法解析或非正数时为 0。 */
  totalBytes: number;
  /** 完成百分比（0..100）；`totalBytes` 为 0 时为 null。 */
  percent: number | null;
}

export interface DownloadFileOptions {
  signal?: AbortSignal;
  onProgress?: (progress: DownloadProgress) => void;
  /** 空闲超时（ms），收到数据即重置；默认 60_000 */
  socketTimeoutMs?: number;
  /** 默认 5 */
  maxRedirects?: number;
  /** 按 URL 解析代理 Agent；返回 undefined 表示直连 */
  agentFor?: (url: string) => Agent | undefined;
  userAgent?: string;
}

/** 最终响应非 200 时抛出的错误。 */
export class DownloadHttpError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(message: string, status: number, url: string) {
    super(message);
    this.name = 'DownloadHttpError';
    this.status = status;
    this.url = url;
  }
}

const DEFAULT_SOCKET_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_REDIRECTS = 5;
const PROGRESS_THROTTLE_MS = 250;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** 下载过程中需要被取消 / 清理的在途对象。 */
interface DownloadState {
  request: ClientRequest | null;
  response: IncomingMessage | null;
  file: WriteStream | null;
  abortError: Error | null;
  timeoutError: Error | null;
}

function createAbortError(reason: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }
  const error = new Error('下载已取消');
  error.name = 'AbortError';
  return error;
}

function createTimeoutError(url: string, timeoutMs: number): Error {
  const error = new Error(`下载超时：${timeoutMs}ms 内未收到数据（${url}）`);
  error.name = 'TimeoutError';
  return error;
}

function parseContentLength(header: string | string[] | undefined): number {
  if (typeof header !== 'string') {
    return 0;
  }
  const parsed = Number.parseInt(header, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function createIncompleteError(
  finalUrl: string,
  expectedBytes: number,
  receivedBytes: number,
): Error {
  return new Error(
    `下载不完整：期望 ${expectedBytes} 字节，实际收到 ${receivedBytes} 字节（${finalUrl}）`,
  );
}

/**
 * 发起单跳 GET 请求，resolve 出响应流。
 *
 * 超时或取消时销毁请求；`state.timeoutError` / `state.abortError` 由调用方在
 * 后续流处理失败时优先采用，因为管道层只会看到 `ECONNRESET`。
 */
function issueRequest(
  target: URL,
  options: DownloadFileOptions,
  state: DownloadState,
  socketTimeoutMs: number,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      reject(new Error(`downloadFile 仅支持 http/https，收到：${target.protocol}（${target}）`));
      return;
    }

    const headers: Record<string, string> = { 'accept-encoding': 'identity' };
    if (options.userAgent) {
      headers['user-agent'] = options.userAgent;
    }
    const requestOptions: RequestOptions = {
      agent: options.agentFor?.(target.toString()),
      headers,
    };

    const onResponse = (response: IncomingMessage): void => resolve(response);
    const request =
      target.protocol === 'https:'
        ? https.get(target, requestOptions, onResponse)
        : http.get(target, requestOptions, onResponse);

    state.request = request;
    request.setTimeout(socketTimeoutMs, () => {
      state.timeoutError = createTimeoutError(target.toString(), socketTimeoutMs);
      request.destroy(state.timeoutError);
    });
    // 响应到达后仍保留监听：销毁类错误只会 reject 一次，settle 后是 no-op，
    // 但监听器本身能避免未处理的 'error' 事件打崩进程。
    request.once('error', (error: Error) => reject(error));
  });
}

/** 把 200 响应流写入目标文件，并在完成时校验内容长度。 */
async function streamResponseToFile(
  response: IncomingMessage,
  finalUrl: string,
  destination: string,
  options: DownloadFileOptions,
  state: DownloadState,
): Promise<void> {
  const totalBytes = parseContentLength(response.headers['content-length']);
  const onProgress = options.onProgress;
  const writeStream = createWriteStream(destination);
  state.file = writeStream;

  let receivedBytes = 0;
  let lastEmittedAt = 0;
  let emittedOnce = false;

  const emitProgress = (force: boolean): void => {
    if (!onProgress) {
      return;
    }
    const now = Date.now();
    if (!force && emittedOnce && now - lastEmittedAt < PROGRESS_THROTTLE_MS) {
      return;
    }
    emittedOnce = true;
    lastEmittedAt = now;
    const percent = totalBytes > 0 ? clampPercent((receivedBytes / totalBytes) * 100) : null;
    onProgress({ receivedBytes, totalBytes, percent });
  };

  response.on('data', (chunk: Buffer) => {
    receivedBytes += chunk.length;
    emitProgress(!emittedOnce);
  });

  try {
    await pipeline(response, writeStream);
  } catch (error) {
    if (state.abortError) {
      throw state.abortError;
    }
    if (state.timeoutError) {
      throw state.timeoutError;
    }
    // 对端在声明长度之前断开（ECONNRESET / premature close）：转成明确的
    // 「下载不完整」错误，比裸网络错误更可诊断。
    if (totalBytes > 0 && receivedBytes < totalBytes) {
      throw createIncompleteError(finalUrl, totalBytes, receivedBytes);
    }
    throw error;
  } finally {
    state.file = null;
  }

  if (totalBytes > 0 && receivedBytes !== totalBytes) {
    throw createIncompleteError(finalUrl, totalBytes, receivedBytes);
  }

  emitProgress(true);
}

/** 跟随重定向直到拿到最终 200 响应并落盘。 */
async function runDownload(
  startUrl: string,
  destination: string,
  options: DownloadFileOptions,
  state: DownloadState,
): Promise<void> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const socketTimeoutMs = options.socketTimeoutMs ?? DEFAULT_SOCKET_TIMEOUT_MS;
  let currentUrl = startUrl;
  let followedRedirects = 0;

  for (;;) {
    if (state.abortError) {
      throw state.abortError;
    }

    const target = new URL(currentUrl);
    const response = await issueRequest(target, options, state, socketTimeoutMs);
    state.response = response;

    const status = response.statusCode ?? 0;
    if (REDIRECT_STATUSES.has(status)) {
      const location = response.headers.location;
      response.destroy();
      if (typeof location !== 'string' || location.length === 0) {
        throw new Error(`重定向响应缺少 location 头：HTTP ${status}（${currentUrl}）`);
      }
      if (followedRedirects >= maxRedirects) {
        throw new Error(`重定向次数超过上限 ${maxRedirects}：${currentUrl}`);
      }
      followedRedirects += 1;
      currentUrl = new URL(location, target).toString();
      continue;
    }

    if (status !== 200) {
      response.destroy();
      throw new DownloadHttpError(`下载失败：HTTP ${status}（${currentUrl}）`, status, currentUrl);
    }

    await streamResponseToFile(response, currentUrl, destination, options, state);
    return;
  }
}

/** 尽力删除未完成的下载文件；清理失败不掩盖原始错误。 */
async function removePartialFile(destination: string): Promise<void> {
  try {
    await rm(destination, { force: true });
  } catch (error) {
    console.warn(`[browser-download] 清理未完成的下载文件失败：${destination}`, error);
  }
}

/**
 * 把 `url` 流式下载到 `destination`。
 *
 * 失败（HTTP 非 200、重定向超限、超时、取消、字节数不符、写盘错误）时 reject，
 * 且不会留下部分文件。
 */
export async function downloadFile(
  url: string,
  destination: string,
  options: DownloadFileOptions = {},
): Promise<void> {
  const signal = options.signal;
  if (signal?.aborted) {
    throw createAbortError(signal.reason);
  }

  const state: DownloadState = {
    request: null,
    response: null,
    file: null,
    abortError: null,
    timeoutError: null,
  };

  const onAbort = (): void => {
    state.abortError = createAbortError(signal?.reason);
    state.request?.destroy(state.abortError);
    state.response?.destroy(state.abortError);
    state.file?.destroy(state.abortError);
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    await runDownload(url, destination, options, state);
  } catch (error) {
    state.file?.destroy();
    await removePartialFile(destination);
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (state.request && !state.request.destroyed) {
      state.request.setTimeout(0);
    }
  }
}
