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

import { authHeader, expectJson, HttpError, jsonAuthHeaders, withQuery } from '../gateway/http.js';

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

export function createArtifactsClient<
  TArtifact = Record<string, unknown>,
  TVersion = Record<string, unknown>,
>(baseUrl: string): ArtifactsClient<TArtifact, TVersion> {
  return {
    async listForSession(token, sessionId, options) {
      const response = await fetch(
        `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/artifacts`,
        { headers: authHeader(token), signal: options?.signal },
      );
      return expectJson<ArtifactSessionArtifactsResponse<TArtifact>>(
        response,
        'artifacts.listForSession',
      );
    },

    async uploadToSession(token, sessionId, input) {
      const response = await fetch(
        `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/artifacts`,
        {
          method: 'POST',
          headers: jsonAuthHeaders(token),
          body: JSON.stringify(input),
        },
      );
      return expectJson<{ artifact: TArtifact }>(response, 'artifacts.uploadToSession');
    },

    async get(token, artifactId, options) {
      const response = await fetch(`${baseUrl}/artifacts/${encodeURIComponent(artifactId)}`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      return expectJson<{ artifact: TArtifact }>(response, 'artifacts.get');
    },

    async listVersions(token, artifactId, options) {
      const response = await fetch(
        `${baseUrl}/artifacts/${encodeURIComponent(artifactId)}/versions`,
        { headers: authHeader(token), signal: options?.signal },
      );
      return expectJson<ArtifactVersionsResponse<TArtifact, TVersion>>(
        response,
        'artifacts.listVersions',
      );
    },

    async create(token, input) {
      const response = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(input),
      });
      return expectJson<{ artifact: TArtifact }>(response, 'artifacts.create');
    },

    async update(token, artifactId, input) {
      const response = await fetch(`${baseUrl}/artifacts/${encodeURIComponent(artifactId)}`, {
        method: 'PUT',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(input),
      });
      return expectJson<{ artifact: TArtifact }>(response, 'artifacts.update');
    },

    async revert(token, artifactId, input) {
      const response = await fetch(
        `${baseUrl}/artifacts/${encodeURIComponent(artifactId)}/revert`,
        {
          method: 'POST',
          headers: jsonAuthHeaders(token),
          body: JSON.stringify(input),
        },
      );
      return expectJson<{ artifact: TArtifact }>(response, 'artifacts.revert');
    },

    async listImageWorkbench(token, options) {
      const params = new URLSearchParams();
      if (options?.type) params.set('type', options.type);
      if (options?.limit !== undefined) params.set('limit', String(options.limit));
      const response = await fetch(withQuery(`${baseUrl}/image-workbench/artifacts`, params), {
        headers: authHeader(token),
        signal: options?.signal,
      });
      if (!response.ok) {
        throw new HttpError(
          `Failed to list image workbench artifacts: ${response.status}`,
          response.status,
        );
      }
      return response.json();
    },

    async generateImage(token, sessionId, input) {
      const response = await fetch(
        `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/images/generations`,
        {
          method: 'POST',
          headers: jsonAuthHeaders(token),
          body: JSON.stringify(input),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new HttpError(
          payload.error?.message ?? `Image generation failed: ${response.status}`,
          response.status,
          payload,
        );
      }
      return payload;
    },
  };
}
