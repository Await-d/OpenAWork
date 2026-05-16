/**
 * `/channels/*` 客户端：消息渠道（Telegram / Discord / 飞书 / 钉钉 / Slack 等）的
 * 列表 / CRUD / 启停 / 订阅目标拉取。
 *
 * 渠道 / 渠道描述符的具体形状由 `apps/web` 自行约束，这里只暴露 `Record<string, unknown>`
 * 透传，不在客户端硬编码字段名，避免与 UI 层重复 schema。
 */

import { authHeader, HttpError, jsonAuthHeaders, readJsonErrorData } from './http.js';

export interface ChannelListResponse<TChannel> {
  channels?: TChannel[];
  error?: string;
}

export interface ChannelDescriptorListResponse<TDescriptor> {
  descriptors?: TDescriptor[];
  error?: string;
}

export interface ChannelMutationResponse<TChannel> {
  channel?: TChannel;
  error?: string;
  status?: TChannel extends { status: infer S } ? S : string;
}

export interface ChannelTargetsResponse<TTarget> {
  groups?: TTarget[];
  error?: string;
}

export interface ChannelsClient<
  TChannel = Record<string, unknown>,
  TDescriptor = Record<string, unknown>,
  TTarget = Record<string, unknown>,
> {
  list(token: string, options?: { signal?: AbortSignal }): Promise<TChannel[]>;
  listDescriptors(token: string, options?: { signal?: AbortSignal }): Promise<TDescriptor[]>;
  create(token: string, draft: unknown): Promise<TChannel>;
  update(token: string, channelId: string, draft: unknown): Promise<TChannel>;
  remove(token: string, channelId: string): Promise<void>;
  start(token: string, channelId: string): Promise<{ status?: string }>;
  stop(token: string, channelId: string): Promise<{ status?: string }>;
  listTargets(token: string, channelId: string): Promise<TTarget[]>;
}

export function createChannelsClient<
  TChannel = Record<string, unknown>,
  TDescriptor = Record<string, unknown>,
  TTarget = Record<string, unknown>,
>(baseUrl: string): ChannelsClient<TChannel, TDescriptor, TTarget> {
  return {
    async list(token, options) {
      const response = await fetch(`${baseUrl}/channels`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      const data = (await response.json()) as ChannelListResponse<TChannel>;
      if (!response.ok) {
        throw new HttpError(
          data.error ?? `channels.list failed: ${response.status}`,
          response.status,
          data,
        );
      }
      return data.channels ?? [];
    },

    async listDescriptors(token, options) {
      const response = await fetch(`${baseUrl}/channels/descriptors`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      const data = (await response.json()) as ChannelDescriptorListResponse<TDescriptor>;
      if (!response.ok) {
        throw new HttpError(
          data.error ?? `channels.listDescriptors failed: ${response.status}`,
          response.status,
          data,
        );
      }
      return data.descriptors ?? [];
    },

    async create(token, draft) {
      const response = await fetch(`${baseUrl}/channels`, {
        method: 'POST',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(draft),
      });
      const data = (await response.json()) as ChannelMutationResponse<TChannel>;
      if (!response.ok || !data.channel) {
        throw new HttpError(
          data.error ?? `channels.create failed: ${response.status}`,
          response.status,
          data,
        );
      }
      return data.channel;
    },

    async update(token, channelId, draft) {
      const response = await fetch(`${baseUrl}/channels/${encodeURIComponent(channelId)}`, {
        method: 'PUT',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(draft),
      });
      const data = (await response.json()) as ChannelMutationResponse<TChannel>;
      if (!response.ok || !data.channel) {
        throw new HttpError(
          data.error ?? `channels.update failed: ${response.status}`,
          response.status,
          data,
        );
      }
      return data.channel;
    },

    async remove(token, channelId) {
      const response = await fetch(`${baseUrl}/channels/${encodeURIComponent(channelId)}`, {
        method: 'DELETE',
        headers: authHeader(token),
      });
      if (!response.ok) {
        const data = await readJsonErrorData<{ error?: string }>(response);
        throw new HttpError(
          data?.error ?? `channels.remove failed: ${response.status}`,
          response.status,
          data,
        );
      }
    },

    async start(token, channelId) {
      const response = await fetch(`${baseUrl}/channels/${encodeURIComponent(channelId)}/start`, {
        method: 'POST',
        headers: authHeader(token),
      });
      const data = (await response.json()) as { status?: string; error?: string };
      if (!response.ok) {
        throw new HttpError(
          data.error ?? `channels.start failed: ${response.status}`,
          response.status,
          data,
        );
      }
      return { ...(data.status !== undefined ? { status: data.status } : {}) };
    },

    async stop(token, channelId) {
      const response = await fetch(`${baseUrl}/channels/${encodeURIComponent(channelId)}/stop`, {
        method: 'POST',
        headers: authHeader(token),
      });
      const data = (await response.json()) as { status?: string; error?: string };
      if (!response.ok) {
        throw new HttpError(
          data.error ?? `channels.stop failed: ${response.status}`,
          response.status,
          data,
        );
      }
      return { ...(data.status !== undefined ? { status: data.status } : {}) };
    },

    async listTargets(token, channelId) {
      const response = await fetch(`${baseUrl}/channels/${encodeURIComponent(channelId)}/groups`, {
        headers: authHeader(token),
      });
      const data = (await response.json()) as ChannelTargetsResponse<TTarget>;
      if (!response.ok) {
        throw new HttpError(
          data.error ?? `channels.listTargets failed: ${response.status}`,
          response.status,
          data,
        );
      }
      return data.groups ?? [];
    },
  };
}
