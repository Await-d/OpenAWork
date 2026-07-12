import type { CapabilityDescriptor } from '@openAwork/shared';
import {
  extractJsonErrorMessage,
  isGenericFetchErrorMessage,
  jsonAuthHeaders,
  readJsonErrorData,
  type JsonErrorData,
  fetchWithTimeout,
} from '../gateway/http.js';

export interface CapabilitiesListResult {
  capabilities: CapabilityDescriptor[];
  errorMessage?: string;
  ok: boolean;
  retryable: boolean;
  status?: number;
}

export interface ChannelCapabilityPreviewPermissions {
  readonly allowReadHome: boolean;
  readonly readablePathPrefixes: readonly string[];
  readonly allowWriteOutside: boolean;
  readonly allowShell: boolean;
  readonly allowSubAgents: boolean;
}

export interface ChannelCapabilityPreviewInput {
  readonly type: string;
  readonly channelLlmToolsEnabled: boolean;
  readonly tools: Readonly<Record<string, boolean>>;
  readonly permissions: ChannelCapabilityPreviewPermissions;
}

export interface ChannelCapabilityCatalogToolGroupCounts {
  readonly web: number;
  readonly lsp: number;
  readonly files: number;
  readonly shell: number;
  readonly orchestration: number;
  readonly session: number;
  readonly mcp: number;
  readonly desktop: number;
  readonly repo: number;
  readonly channel: number;
  readonly other: number;
}

export interface ChannelCapabilityCatalogCounts {
  readonly agents: number;
  readonly skills: number;
  readonly mcps: number;
  readonly tools: number;
  readonly toolGroups: ChannelCapabilityCatalogToolGroupCounts;
  readonly commands: number;
}

export interface CapabilitiesClient {
  list(token: string, sessionId?: string | null): Promise<CapabilityDescriptor[]>;
  listResult(token: string, sessionId?: string | null): Promise<CapabilitiesListResult>;
  previewChannel(
    token: string,
    input: ChannelCapabilityPreviewInput,
  ): Promise<ChannelCapabilityCatalogCounts>;
}

function isRetryableCapabilitiesStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function buildCapabilitiesListErrorMessage(
  status: number,
  data: JsonErrorData | undefined,
): string {
  const extracted = extractJsonErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return '认证失效或当前账号无权读取能力列表。';
  }
  return `加载能力列表失败（HTTP ${status}）。`;
}

function isGenericCapabilitiesNetworkErrorMessage(message: string): boolean {
  return isGenericFetchErrorMessage(message);
}

function buildCapabilitiesActionErrorMessage(
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
  return `${actionLabel}失败（HTTP ${status}）。`;
}

function normalizeCapabilitiesError(error: unknown): Error {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0 && !isGenericCapabilitiesNetworkErrorMessage(message)) {
      return error;
    }
  }
  return new Error('网络异常，加载能力列表失败。');
}

function normalizeCapabilitiesActionError(actionLabel: string, error: unknown): Error {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0 && !isGenericCapabilitiesNetworkErrorMessage(message)) {
      return error;
    }
  }
  return new Error(`网络异常，${actionLabel}失败。`);
}

export function createCapabilitiesClient(baseUrl: string): CapabilitiesClient {
  const listResult = async (
    token: string,
    sessionId?: string | null,
  ): Promise<CapabilitiesListResult> => {
    const url = new URL(`${baseUrl}/capabilities`);
    if (sessionId) {
      url.searchParams.set('sessionId', sessionId);
    }
    try {
      const response = await fetchWithTimeout(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const data = await readJsonErrorData<JsonErrorData>(response);
        return {
          capabilities: [],
          ok: false,
          retryable: isRetryableCapabilitiesStatus(response.status),
          errorMessage: buildCapabilitiesListErrorMessage(response.status, data),
          status: response.status,
        };
      }
      const data = (await response.json()) as { capabilities?: CapabilityDescriptor[] };
      return {
        capabilities: data.capabilities ?? [],
        ok: true,
        retryable: false,
      };
    } catch (error) {
      return {
        capabilities: [],
        ok: false,
        retryable: true,
        errorMessage: normalizeCapabilitiesError(error).message,
      };
    }
  };

  return {
    async list(token: string, sessionId?: string | null): Promise<CapabilityDescriptor[]> {
      const result = await listResult(token, sessionId);
      if (!result.ok) {
        throw new Error(result.errorMessage ?? '加载能力列表失败');
      }
      return result.capabilities;
    },

    async previewChannel(
      token: string,
      input: ChannelCapabilityPreviewInput,
    ): Promise<ChannelCapabilityCatalogCounts> {
      try {
        const response = await fetchWithTimeout(`${baseUrl}/capabilities/channel-preview`, {
          method: 'POST',
          headers: jsonAuthHeaders(token),
          body: JSON.stringify(input),
        });
        if (!response.ok) {
          const data = await readJsonErrorData<JsonErrorData>(response);
          throw new Error(
            buildCapabilitiesActionErrorMessage('预览通道能力目录', response.status, data),
          );
        }
        const data = (await response.json()) as { counts?: ChannelCapabilityCatalogCounts };
        if (!data.counts) {
          throw new Error('预览通道能力目录失败：响应缺少 counts。');
        }
        return data.counts;
      } catch (error) {
        throw normalizeCapabilitiesActionError('预览通道能力目录', error);
      }
    },

    listResult,
  };
}
