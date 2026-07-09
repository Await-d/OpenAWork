import { randomBytes, randomUUID } from 'node:crypto';
import { channelFetch } from './channel-http.js';
import { isRecord, readRecordArray, readString } from './inbound-utils.js';
import {
  buildWeixinFileItems,
  buildWeixinImageItems,
  type WeixinSendFileParams,
  type WeixinSendImageParams,
} from './weixin-api-media.js';

export const DEFAULT_WEIXIN_BASE_URL = 'https://ilinkai.weixin.qq.com';

export interface WeixinApiOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly routeTag?: string;
}

export interface WeixinGetUpdatesResponse {
  readonly ret?: number;
  readonly errcode?: number;
  readonly errmsg?: string;
  readonly msgs?: readonly Record<string, unknown>[];
  readonly get_updates_buf?: string;
  readonly longpolling_timeout_ms?: number;
}

export interface WeixinSendMessageParams {
  readonly toUserId: string;
  readonly text: string;
  readonly contextToken: string;
  readonly signal?: AbortSignal;
}

export interface WeixinApiClient {
  getUpdates(
    syncBuf: string,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<WeixinGetUpdatesResponse>;
  sendMessage(params: WeixinSendMessageParams): Promise<{ messageId: string }>;
  sendImage(params: WeixinSendImageParams): Promise<{ messageId: string }>;
  sendFile(params: WeixinSendFileParams): Promise<{ messageId: string }>;
}

function normalizeBaseUrl(baseUrl: string): string {
  return (baseUrl || DEFAULT_WEIXIN_BASE_URL).replace(/\/+$/, '');
}

function buildWechatUin(): string {
  const value = randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(value), 'utf8').toString('base64');
}

function buildHeaders(options: WeixinApiOptions, wechatUin: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    Authorization: `Bearer ${options.token}`,
    'X-WECHAT-UIN': wechatUin,
  };
  if (options.routeTag) {
    headers.SKRouteTag = options.routeTag;
  }
  return headers;
}

function readNumber(data: unknown, key: string): number | undefined {
  if (!isRecord(data)) {
    return undefined;
  }
  const value = data[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function parseGetUpdatesResponse(raw: unknown): WeixinGetUpdatesResponse {
  if (!isRecord(raw)) {
    return {};
  }
  return {
    ret: readNumber(raw, 'ret'),
    errcode: readNumber(raw, 'errcode'),
    errmsg: readString(raw, 'errmsg') || undefined,
    msgs: readRecordArray(raw, 'msgs'),
    get_updates_buf: readString(raw, 'get_updates_buf') || undefined,
    longpolling_timeout_ms: readNumber(raw, 'longpolling_timeout_ms'),
  };
}

function readWeixinError(raw: unknown): string | null {
  if (!isRecord(raw)) {
    return null;
  }
  const code = readNumber(raw, 'errcode') ?? readNumber(raw, 'ret') ?? 0;
  if (code === 0) {
    return null;
  }
  return readString(raw, 'errmsg') || `errcode ${code}`;
}

export class WeixinApi implements WeixinApiClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(options: WeixinApiOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.headers = buildHeaders(options, buildWechatUin());
  }

  async getUpdates(
    syncBuf: string,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<WeixinGetUpdatesResponse> {
    const raw = await this.postJson(
      'ilink/bot/getupdates',
      { get_updates_buf: syncBuf },
      {
        timeoutMs,
        signal,
      },
    );
    return parseGetUpdatesResponse(raw);
  }

  async sendMessage(params: WeixinSendMessageParams): Promise<{ messageId: string }> {
    return this.sendItems({
      toUserId: params.toUserId,
      contextToken: params.contextToken,
      items: [{ type: 1, text_item: { text: params.text } }],
      signal: params.signal,
    });
  }

  async sendImage(params: WeixinSendImageParams): Promise<{ messageId: string }> {
    const items = await buildWeixinImageItems(params, {
      postJson: (path, body, options) => this.postJson(path, body, options),
    });
    return this.sendItems({
      toUserId: params.toUserId,
      contextToken: params.contextToken,
      items,
      signal: params.signal,
    });
  }

  async sendFile(params: WeixinSendFileParams): Promise<{ messageId: string }> {
    const items = await buildWeixinFileItems(params, {
      postJson: (path, body, options) => this.postJson(path, body, options),
    });
    return this.sendItems({
      toUserId: params.toUserId,
      contextToken: params.contextToken,
      items,
      signal: params.signal,
    });
  }

  private async sendItems(params: {
    readonly toUserId: string;
    readonly contextToken: string;
    readonly items: readonly Record<string, unknown>[];
    readonly signal?: AbortSignal;
  }): Promise<{ messageId: string }> {
    const clientId = randomUUID();
    for (const item of params.items) {
      const raw = await this.postJson(
        'ilink/bot/sendmessage',
        {
          msg: {
            from_user_id: '',
            to_user_id: params.toUserId,
            client_id: clientId,
            message_type: 2,
            message_state: 2,
            item_list: [item],
            context_token: params.contextToken,
          },
        },
        { timeoutMs: 20_000, signal: params.signal },
      );
      const error = readWeixinError(raw);
      if (error) {
        throw new Error(`Weixin sendmessage failed: ${error}`);
      }
    }
    return { messageId: clientId };
  }

  private async postJson(
    path: string,
    body: unknown,
    options: { readonly timeoutMs?: number; readonly signal?: AbortSignal },
  ): Promise<unknown> {
    const response = await channelFetch(`${this.baseUrl}/${path}`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(`Weixin HTTP ${response.status}: ${rawText || response.statusText}`);
    }
    if (!rawText) {
      return {};
    }
    return JSON.parse(rawText);
  }
}

export const createWeixinApi = (options: WeixinApiOptions): WeixinApiClient =>
  new WeixinApi(options);

export type { WeixinSendFileParams, WeixinSendImageParams } from './weixin-api-media.js';
