/**
 * `/channels/*` 客户端：消息渠道（Telegram / Discord / 飞书 / 钉钉 / Slack 等）的
 * 列表 / CRUD / 启停 / 订阅目标拉取。
 *
 * 渠道 / 渠道描述符的具体形状由 `apps/web` 自行约束，这里只暴露 `Record<string, unknown>`
 * 透传，不在客户端硬编码字段名，避免与 UI 层重复 schema。
 */

import {
  authHeader,
  extractJsonErrorMessage,
  HttpError,
  isGenericFetchErrorMessage,
  jsonAuthHeaders,
  type JsonErrorData,
  fetchWithTimeout,
} from '../gateway/http.js';
import type {
  ChannelConversationsResponse,
  ChannelDescriptorListResponse,
  ChannelListResponse,
  ChannelMutationResponse,
  ChannelsClient,
  ChannelTargetsResponse,
  WeixinLoginStartResponse,
  WeixinLoginWaitResponse,
} from './channels-types.js';

export type * from './channels-types.js';

function buildChannelsActionErrorMessage(
  actionLabel: string,
  status: number,
  data: JsonErrorData | undefined,
): string {
  const extracted = extractJsonErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return `认证失效或当前账号无权${actionLabel}。`;
  }
  if (status === 404) {
    return `目标渠道资源不存在，无法${actionLabel}。`;
  }
  if (status === 409) {
    return `当前状态不允许${actionLabel}。`;
  }
  return `${actionLabel}失败（HTTP ${status}）。`;
}

function isGenericChannelsNetworkErrorMessage(message: string): boolean {
  return isGenericFetchErrorMessage(message);
}

function normalizeChannelsError(actionLabel: string, error: unknown): Error {
  if (error instanceof HttpError) {
    const extracted = extractJsonErrorMessage(
      (error.data ?? undefined) as JsonErrorData | undefined,
    );
    if (extracted) {
      return new HttpError(extracted, error.status, error.data);
    }
    return error;
  }
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0 && !isGenericChannelsNetworkErrorMessage(message)) {
      return error;
    }
  }
  return new Error(`网络异常，${actionLabel}失败。`);
}

async function performChannelsRequest<T>(input: {
  actionLabel: string;
  request: () => Promise<Response>;
}): Promise<T> {
  try {
    const response = await input.request();
    const data = (await response.json().catch(() => null)) as
      | ChannelListResponse<T>
      | ChannelDescriptorListResponse<T>
      | ChannelMutationResponse<T>
      | ChannelTargetsResponse<T>
      | ChannelConversationsResponse
      | (JsonErrorData & { status?: string })
      | null;
    if (!response.ok) {
      throw new HttpError(
        buildChannelsActionErrorMessage(input.actionLabel, response.status, data ?? undefined),
        response.status,
        data ?? undefined,
      );
    }
    return (data ?? {}) as T;
  } catch (error) {
    throw normalizeChannelsError(input.actionLabel, error);
  }
}

export function createChannelsClient<
  TChannel = Record<string, unknown>,
  TDescriptor = Record<string, unknown>,
  TTarget = Record<string, unknown>,
>(baseUrl: string): ChannelsClient<TChannel, TDescriptor, TTarget> {
  return {
    async list(token, options) {
      const data = await performChannelsRequest<ChannelListResponse<TChannel>>({
        actionLabel: '读取消息渠道列表',
        request: () =>
          fetchWithTimeout(`${baseUrl}/channels`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
      return data.channels ?? [];
    },

    async listDescriptors(token, options) {
      const data = await performChannelsRequest<ChannelDescriptorListResponse<TDescriptor>>({
        actionLabel: '读取渠道描述符',
        request: () =>
          fetchWithTimeout(`${baseUrl}/channels/descriptors`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
      return data.descriptors ?? [];
    },

    async create(token, draft) {
      const data = await performChannelsRequest<ChannelMutationResponse<TChannel>>({
        actionLabel: '创建消息渠道',
        request: () =>
          fetchWithTimeout(`${baseUrl}/channels`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(draft),
          }),
      });
      if (!data.channel) {
        throw new Error('渠道响应缺少 channel 数据。');
      }
      return data.channel;
    },

    async update(token, channelId, draft) {
      const data = await performChannelsRequest<ChannelMutationResponse<TChannel>>({
        actionLabel: '更新消息渠道',
        request: () =>
          fetchWithTimeout(`${baseUrl}/channels/${encodeURIComponent(channelId)}`, {
            method: 'PUT',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(draft),
          }),
      });
      if (!data.channel) {
        throw new Error('渠道响应缺少 channel 数据。');
      }
      return data.channel;
    },

    async remove(token, channelId) {
      await performChannelsRequest({
        actionLabel: '删除消息渠道',
        request: () =>
          fetchWithTimeout(`${baseUrl}/channels/${encodeURIComponent(channelId)}`, {
            method: 'DELETE',
            headers: authHeader(token),
          }),
      });
    },

    async start(token, channelId) {
      const data = await performChannelsRequest<{ status?: string; error?: string }>({
        actionLabel: '启动消息渠道',
        request: () =>
          fetchWithTimeout(`${baseUrl}/channels/${encodeURIComponent(channelId)}/start`, {
            method: 'POST',
            headers: authHeader(token),
          }),
      });
      return { ...(data.status !== undefined ? { status: data.status } : {}) };
    },

    async stop(token, channelId) {
      const data = await performChannelsRequest<{ status?: string; error?: string }>({
        actionLabel: '停止消息渠道',
        request: () =>
          fetchWithTimeout(`${baseUrl}/channels/${encodeURIComponent(channelId)}/stop`, {
            method: 'POST',
            headers: authHeader(token),
          }),
      });
      return { ...(data.status !== undefined ? { status: data.status } : {}) };
    },

    async listTargets(token, channelId) {
      const data = await performChannelsRequest<ChannelTargetsResponse<TTarget>>({
        actionLabel: '读取渠道订阅目标',
        request: () =>
          fetchWithTimeout(`${baseUrl}/channels/${encodeURIComponent(channelId)}/groups`, {
            headers: authHeader(token),
          }),
      });
      return data.groups ?? [];
    },

    async listConversations(token, channelId, options) {
      const query = new URLSearchParams();
      if (options?.limit !== undefined) {
        query.set('limit', String(options.limit));
      }
      if (options?.offset !== undefined) {
        query.set('offset', String(options.offset));
      }
      const suffix = query.toString();
      const data = await performChannelsRequest<ChannelConversationsResponse>({
        actionLabel: '读取渠道对话历史',
        request: () =>
          fetchWithTimeout(
            `${baseUrl}/channels/${encodeURIComponent(channelId)}/conversations${
              suffix ? `?${suffix}` : ''
            }`,
            {
              headers: authHeader(token),
            },
          ),
      });
      return data.conversations ?? [];
    },

    async startWeixinLogin(token, input) {
      return performChannelsRequest<WeixinLoginStartResponse>({
        actionLabel: '启动微信登录',
        request: () =>
          fetchWithTimeout(`${baseUrl}/channels/weixin/login/start`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(input),
          }),
      });
    },

    async waitWeixinLogin(token, input) {
      return performChannelsRequest<WeixinLoginWaitResponse>({
        actionLabel: '等待微信登录',
        request: () =>
          fetchWithTimeout(`${baseUrl}/channels/weixin/login/wait`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(input),
            timeoutMs: Math.max(input.timeoutMs ?? 60_000, 1_000) + 5_000,
          }),
      });
    },
  };
}
