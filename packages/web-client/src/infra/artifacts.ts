/**
 * 产物（Artifact）相关网关客户端：
 *
 * - GET `/sessions/:id/artifacts` 列出会话内产物；
 * - POST `/artifacts` 创建产物；
 * - PUT `/artifacts/:id` 保存新版本；
 * - GET `/artifacts/:id` 获取产物详情（图片场景里包含 base64 内容）；
 * - GET `/artifacts/:id/versions` 列出版本；
 * - POST `/artifacts/:id/revert` 恢复指定版本；
 * - GET `/image-workbench/artifacts` 跨会话的图片工作台聚合视图；
 * - POST `/sessions/:id/images/generations` 触发图片生成。
 *
 * 类型保持 `unknown` 透传：apps/web 已经维护了 `ArtifactRecord`/`ArtifactVersionRecord`
 * 的具体形状，跨包重复定义会带来同步成本——客户端只兜底协议层细节。
 */

import {
  authHeader,
  extractJsonErrorMessage,
  HttpError,
  isGenericFetchErrorMessage,
  jsonAuthHeaders,
  readJsonErrorData,
  type JsonErrorData,
  withQuery,
  fetchWithTimeout,
} from '../gateway/http.js';

export interface ArtifactSessionArtifactsResponse<TArtifact> {
  contentArtifacts?: TArtifact[];
  [key: string]: unknown;
}

export interface ArtifactVersionsResponse<TArtifact, TVersion> {
  artifact: TArtifact;
  versions: TVersion[];
}

export interface CreateArtifactInput {
  sessionId: string;
  title: string;
  content: string;
  type: string;
  createdBy?: string;
}

export interface UpdateArtifactInput {
  title: string;
  content: string;
  createdBy?: string;
}

export interface RevertArtifactInput {
  versionId: string;
  createdBy?: string;
}

export interface ImageGenerationInput {
  prompt: string;
  size: string;
  quality?: string;
  outputFormat?: string;
  background?: string;
  inputArtifacts?: Array<{ artifactId: string; fileName?: string; mimeType?: string }>;
}

export interface UploadSessionArtifactInput {
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  contentBase64: string;
}

export interface ArtifactsClient<
  TArtifact = Record<string, unknown>,
  TVersion = Record<string, unknown>,
> {
  listForSession(
    token: string,
    sessionId: string,
    options?: { signal?: AbortSignal },
  ): Promise<ArtifactSessionArtifactsResponse<TArtifact>>;
  /** POST `/sessions/:id/artifacts` — 上传二进制附件（base64 编码）。 */
  uploadToSession(
    token: string,
    sessionId: string,
    input: UploadSessionArtifactInput,
  ): Promise<{ artifact: TArtifact }>;
  get(
    token: string,
    artifactId: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ artifact: TArtifact }>;
  listVersions(
    token: string,
    artifactId: string,
    options?: { signal?: AbortSignal },
  ): Promise<ArtifactVersionsResponse<TArtifact, TVersion>>;
  create(token: string, input: CreateArtifactInput): Promise<{ artifact: TArtifact }>;
  update(
    token: string,
    artifactId: string,
    input: UpdateArtifactInput,
  ): Promise<{ artifact: TArtifact }>;
  revert(
    token: string,
    artifactId: string,
    input: RevertArtifactInput,
  ): Promise<{ artifact: TArtifact }>;
  /**
   * GET `/image-workbench/artifacts?type=&limit=`：跨会话聚合视图。
   * 返回原始负载，由 `apps/web` 的页面型解析。
   */
  listImageWorkbench(
    token: string,
    options?: { type?: string; limit?: number; signal?: AbortSignal },
  ): Promise<unknown>;
  /**
   * POST `/sessions/:id/images/generations`：触发图片生成。
   * 错误响应通常带 `error.message`，由调用方决定文案。
   */
  generateImage(token: string, sessionId: string, input: ImageGenerationInput): Promise<unknown>;
}

function buildArtifactsActionErrorMessage(
  actionLabel: string,
  status: number,
  data: (JsonErrorData & { error?: string | { message?: string } }) | undefined,
): string {
  const objectError = data?.error;
  const nestedErrorMessage =
    objectError &&
    typeof objectError === 'object' &&
    typeof (objectError as { message?: unknown }).message === 'string'
      ? ((objectError as { message: string }).message ?? null)
      : null;
  if (nestedErrorMessage && nestedErrorMessage.length > 0) {
    return nestedErrorMessage;
  }
  const extracted = extractJsonErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return `认证失效或当前账号无权${actionLabel}。`;
  }
  if (status === 404) {
    return `目标产物资源不存在，无法${actionLabel}。`;
  }
  if (status === 409) {
    return `当前状态不允许${actionLabel}。`;
  }
  return `${actionLabel}失败（HTTP ${status}）。`;
}

function isGenericArtifactsNetworkErrorMessage(message: string): boolean {
  return isGenericFetchErrorMessage(message);
}

function normalizeArtifactsError(actionLabel: string, error: unknown): Error {
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
    if (message.length > 0 && !isGenericArtifactsNetworkErrorMessage(message)) {
      return error;
    }
  }
  return new Error(`网络异常，${actionLabel}失败。`);
}

async function performArtifactsRequest<T>(input: {
  actionLabel: string;
  parseJson?: boolean;
  request: () => Promise<Response>;
}): Promise<T> {
  try {
    const response = await input.request();
    if (!response.ok) {
      const data = await readJsonErrorData<
        JsonErrorData & { error?: string | { message?: string } }
      >(response);
      throw new HttpError(
        buildArtifactsActionErrorMessage(input.actionLabel, response.status, data),
        response.status,
        data,
      );
    }
    if (input.parseJson === false || response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  } catch (error) {
    throw normalizeArtifactsError(input.actionLabel, error);
  }
}

export function createArtifactsClient<
  TArtifact = Record<string, unknown>,
  TVersion = Record<string, unknown>,
>(baseUrl: string): ArtifactsClient<TArtifact, TVersion> {
  return {
    async listForSession(token, sessionId, options) {
      return performArtifactsRequest<ArtifactSessionArtifactsResponse<TArtifact>>({
        actionLabel: '读取会话产物列表',
        request: () =>
          fetchWithTimeout(`${baseUrl}/sessions/${encodeURIComponent(sessionId)}/artifacts`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async uploadToSession(token, sessionId, input) {
      return performArtifactsRequest<{ artifact: TArtifact }>({
        actionLabel: '上传会话产物',
        request: () =>
          fetchWithTimeout(`${baseUrl}/sessions/${encodeURIComponent(sessionId)}/artifacts`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(input),
          }),
      });
    },

    async get(token, artifactId, options) {
      return performArtifactsRequest<{ artifact: TArtifact }>({
        actionLabel: '读取产物详情',
        request: () =>
          fetchWithTimeout(`${baseUrl}/artifacts/${encodeURIComponent(artifactId)}`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async listVersions(token, artifactId, options) {
      return performArtifactsRequest<ArtifactVersionsResponse<TArtifact, TVersion>>({
        actionLabel: '读取产物版本列表',
        request: () =>
          fetchWithTimeout(`${baseUrl}/artifacts/${encodeURIComponent(artifactId)}/versions`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async create(token, input) {
      return performArtifactsRequest<{ artifact: TArtifact }>({
        actionLabel: '创建产物',
        request: () =>
          fetchWithTimeout(`${baseUrl}/artifacts`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(input),
          }),
      });
    },

    async update(token, artifactId, input) {
      return performArtifactsRequest<{ artifact: TArtifact }>({
        actionLabel: '更新产物',
        request: () =>
          fetchWithTimeout(`${baseUrl}/artifacts/${encodeURIComponent(artifactId)}`, {
            method: 'PUT',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(input),
          }),
      });
    },

    async revert(token, artifactId, input) {
      return performArtifactsRequest<{ artifact: TArtifact }>({
        actionLabel: '回滚产物版本',
        request: () =>
          fetchWithTimeout(`${baseUrl}/artifacts/${encodeURIComponent(artifactId)}/revert`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(input),
          }),
      });
    },

    async listImageWorkbench(token, options) {
      const params = new URLSearchParams();
      if (options?.type) params.set('type', options.type);
      if (options?.limit !== undefined) params.set('limit', String(options.limit));
      return performArtifactsRequest<unknown>({
        actionLabel: '读取图片工作台产物列表',
        request: () =>
          fetchWithTimeout(withQuery(`${baseUrl}/image-workbench/artifacts`, params), {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async generateImage(token, sessionId, input) {
      return performArtifactsRequest<unknown>({
        actionLabel: '生成图片',
        request: () =>
          fetchWithTimeout(
            `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/images/generations`,
            {
              timeoutMs: 120_000,
              method: 'POST',
              headers: jsonAuthHeaders(token),
              body: JSON.stringify(input),
            },
          ),
      });
    },
  };
}
