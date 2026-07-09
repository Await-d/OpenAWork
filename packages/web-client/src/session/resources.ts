import {
  extractJsonErrorMessage,
  fetchWithTimeout,
  isGenericFetchErrorMessage,
  jsonAuthHeaders,
  readJsonErrorData,
  type JsonErrorData,
} from '../gateway/http.js';
import { EMPTY_RESOURCE_CATALOG, parseResourceCatalog } from './resources-parser.js';
import type {
  ResourceCatalog,
  ResourcesClient,
  ResourcesListResult,
  UploadResourceInput,
} from './resources-types.js';

export { RESOURCE_USAGE_DEFAULTS } from './resources-types.js';
export type {
  ResourceAgentCatalogEntry,
  ResourceArea,
  ResourceCatalog,
  ResourceCatalogEntry,
  ResourceCommandCatalogEntry,
  ResourceExtensionCatalogEntry,
  ResourceFeature,
  ResourceIntegrationMode,
  ResourceMcpCatalogEntry,
  ResourcesClient,
  ResourcesListResult,
  ResourceSkillCatalogEntry,
  ResourceTextCatalogEntry,
  ResourceUsageKind,
  ResourceVisibility,
  UploadResourceInput,
} from './resources-types.js';

function isRetryableResourcesStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function buildResourcesListErrorMessage(status: number, data: JsonErrorData | undefined): string {
  const extracted = extractJsonErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return '认证失效或当前账号无权读取资源目录。';
  }
  return `加载资源目录失败（HTTP ${status}）。`;
}

function normalizeResourcesError(error: unknown): Error {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0 && !isGenericFetchErrorMessage(message)) {
      return error;
    }
  }
  return new Error('网络异常，加载资源目录失败。');
}

export function createResourcesClient(baseUrl: string): ResourcesClient {
  const readCatalogResponse = async (
    response: Response,
    label: string,
  ): Promise<ResourceCatalog> => {
    if (!response.ok) {
      const data = await readJsonErrorData<JsonErrorData>(response);
      throw new Error(extractJsonErrorMessage(data) ?? `${label}失败（HTTP ${response.status}）。`);
    }
    return parseResourceCatalog(await response.json());
  };

  const listResult = async (token: string): Promise<ResourcesListResult> => {
    try {
      const response = await fetchWithTimeout(`${baseUrl}/resources`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const data = await readJsonErrorData<JsonErrorData>(response);
        return {
          resources: EMPTY_RESOURCE_CATALOG,
          ok: false,
          retryable: isRetryableResourcesStatus(response.status),
          errorMessage: buildResourcesListErrorMessage(response.status, data),
          status: response.status,
        };
      }
      return {
        resources: parseResourceCatalog(await response.json()),
        ok: true,
        retryable: false,
      };
    } catch (error) {
      return {
        resources: EMPTY_RESOURCE_CATALOG,
        ok: false,
        retryable: true,
        errorMessage: normalizeResourcesError(error).message,
      };
    }
  };

  return {
    async list(token: string): Promise<ResourceCatalog> {
      const result = await listResult(token);
      if (!result.ok) {
        throw new Error(result.errorMessage ?? '加载资源目录失败');
      }
      return result.resources;
    },

    listResult,

    async upload(token: string, input: UploadResourceInput): Promise<ResourceCatalog> {
      const response = await fetchWithTimeout(`${baseUrl}/resources/uploads`, {
        method: 'POST',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(input),
      });
      return readCatalogResponse(response, '上传资源');
    },

    async remove(token: string, resourceId: string): Promise<ResourceCatalog> {
      const response = await fetchWithTimeout(
        `${baseUrl}/resources/uploads/${encodeURIComponent(resourceId)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      return readCatalogResponse(response, '删除资源');
    },
  };
}
