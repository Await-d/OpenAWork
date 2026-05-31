import type { CapabilityDescriptor } from '@openAwork/shared';
import {
  extractJsonErrorMessage,
  isGenericFetchErrorMessage,
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

export interface CapabilitiesClient {
  list(token: string, sessionId?: string | null): Promise<CapabilityDescriptor[]>;
  listResult(token: string, sessionId?: string | null): Promise<CapabilitiesListResult>;
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

function normalizeCapabilitiesError(error: unknown): Error {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0 && !isGenericCapabilitiesNetworkErrorMessage(message)) {
      return error;
    }
  }
  return new Error('网络异常，加载能力列表失败。');
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

    listResult,
  };
}
