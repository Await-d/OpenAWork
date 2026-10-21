/**
 * 产物（Artifact）相关网关客户端：
 *
 * - GET `/sessions/:id/artifacts` 列出会话内产物；
 * - POST `/artifacts` 创建产物；
 * - PUT `/artifacts/:id` 保存新版本；
 * - GET `/artifacts/:id` 获取产物详情（图片场景里包含 base64 内容）；
 * - GET `/artifacts/:id/versions` 列出版本；
 * - POST `/artifacts/:id/revert` 恢复指定版本；
 * - DELETE `/artifacts/:id` 删除产物；
 * - GET `/image-workbench/artifacts` 跨会话的图片工作台聚合视图；
 * - POST `/sessions/:id/images/generations` 触发图片生成。
 *
 * 类型保持 `unknown` 透传：apps/web 已经维护了 `ArtifactRecord`/`ArtifactVersionRecord`
 * 的具体形状，跨包重复定义会带来同步成本——客户端只兜底协议层细节。
 */

import { resolveImageGenerationTimeoutMs } from '@openAwork/shared';
import { createSseFrameParser } from '../gateway/sse-frames.js';
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

/**
 * 二进制附件上传 / 下载的超时上限（ms）。
 *
 * `fetchWithTimeout` 的默认上限（20s）是按「读 JSON 接口」定的：一个 10MiB 的附件在
 * 慢上行或远端网关下，光是传输 + base64 编解码就很容易超过它——而超时会被归一成
 * 「网络异常」，用户看到的是随机失败，排查方向也会被带偏。这里给足余量；需要更早
 * 放弃的调用方可以自行传 `signal`。
 */
const ARTIFACT_TRANSFER_TIMEOUT_MS = 120_000;

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

export interface ImageGenerationArtifactRef {
  artifactId: string;
  fileName?: string;
  mimeType?: string;
}

export interface ImageGenerationInput {
  prompt: string;
  size: string;
  quality?: string;
  outputFormat?: string;
  background?: string;
  moderation?: string;
  outputCompression?: number;
  /** 单次生成张数（对应官方 `n`）；缺省 1。 */
  count?: number;
  inputArtifacts?: ImageGenerationArtifactRef[];
  /** 局部编辑遮罩（官方 `/images/edits` 的 `mask`），必须与参考图同格式同尺寸且带 alpha。 */
  maskArtifact?: ImageGenerationArtifactRef;
}

/** 生图响应里可消费到的产物描述（`artifacts` 为 `n>1` 的全量列表）。 */
export interface ImageGenerationResponseArtifact {
  id: string;
  title: string;
  type: 'image';
  metadata?: Record<string, unknown>;
}

/** 流式生图的中间稿（官方 `image_generation.partial_image`）。 */
export interface ImageGenerationPartialImage {
  index: number;
  mimeType: string;
  partialImageBase64: string;
}

/** 流式生图的失败事件（结构与 JSON 端点的 `error` 对象一致）。 */
export interface ImageGenerationStreamError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ImageGenerationStreamHandlers {
  /** 最终产物负载，与 `generateImage` 的成功响应同构。 */
  onDone: (payload: unknown) => void;
  onError: (error: ImageGenerationStreamError) => void;
  /** 中间稿预览；调用方不应把它当产物持久化。 */
  onPartial?: (partial: ImageGenerationPartialImage) => void;
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
  /**
   * GET `/sessions/:id/artifacts/:artifactId/content` — 下载上传附件的二进制内容。
   *
   * 与 `get` 的区别：`get` 查询的是 SQLite 内容型产物（`GET /artifacts/:id`），
   * 上传路由写入的磁盘型产物不在其中；跨端恢复附件必须走这条读取面。
   */
  downloadFromSession(
    token: string,
    sessionId: string,
    artifactId: string,
    options?: { signal?: AbortSignal },
  ): Promise<Blob>;
  /** DELETE `/sessions/:id/artifacts/:artifactId` — 删除磁盘型附件（索引 + 磁盘文件）。 */
  removeFromSession(token: string, sessionId: string, artifactId: string): Promise<boolean>;
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
  remove(token: string, artifactId: string): Promise<void>;
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
  /**
   * POST `/sessions/:id/images/generations/stream`：流式生图。
   * 中间稿经 `handlers.onPartial` 实时回调，最终产物经 `handlers.onDone`（与
   * `generateImage` 的成功响应同构），失败经 `handlers.onError`。
   */
  generateImageStream(
    token: string,
    sessionId: string,
    input: ImageGenerationInput,
    handlers: ImageGenerationStreamHandlers,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
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
            timeoutMs: ARTIFACT_TRANSFER_TIMEOUT_MS,
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(input),
          }),
      });
    },

    async downloadFromSession(token, sessionId, artifactId, options) {
      try {
        const response = await fetchWithTimeout(
          `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(
            artifactId,
          )}/content`,
          {
            timeoutMs: ARTIFACT_TRANSFER_TIMEOUT_MS,
            headers: authHeader(token),
            signal: options?.signal,
          },
        );
        if (!response.ok) {
          const data = await readJsonErrorData<
            JsonErrorData & { error?: string | { message?: string } }
          >(response);
          throw new HttpError(
            buildArtifactsActionErrorMessage('下载会话产物', response.status, data),
            response.status,
            data,
          );
        }
        // 二进制响应不解析 JSON：调用方拿 Blob 后自行构造 File（名字以队列元数据为准）。
        return await response.blob();
      } catch (error) {
        throw normalizeArtifactsError('下载会话产物', error);
      }
    },

    async removeFromSession(token, sessionId, artifactId) {
      const payload = await performArtifactsRequest<{ removed?: unknown }>({
        actionLabel: '删除会话产物',
        request: () =>
          fetchWithTimeout(
            `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(
              artifactId,
            )}`,
            { method: 'DELETE', headers: authHeader(token) },
          ),
      });
      return payload?.removed === true;
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

    async remove(token, artifactId) {
      await performArtifactsRequest({
        actionLabel: '删除产物',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/artifacts/${encodeURIComponent(artifactId)}`, {
            method: 'DELETE',
            headers: authHeader(token),
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
      // 生图是长任务：官方给出的上限是「复杂 prompt 最长约 2 分钟」，4K 更久。
      // 固定的 120s 会把正常请求掐断，而超时会被归一成「网络异常」，排查方向被带偏。
      return performArtifactsRequest<unknown>({
        actionLabel: '生成图片',
        request: () =>
          fetchWithTimeout(
            `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/images/generations`,
            {
              timeoutMs: resolveImageGenerationTimeoutMs(input.size),
              method: 'POST',
              headers: jsonAuthHeaders(token),
              body: JSON.stringify(input),
            },
          ),
      });
    },

    async generateImageStream(token, sessionId, input, handlers, options) {
      let response: Response;
      try {
        response = await fetchWithTimeout(
          `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/images/generations/stream`,
          {
            // 与 JSON 端点同一条超时阶梯：整条流超过该档位预算即判失败，
            // 避免半开连接把 UI 永久挂在「生成中」。
            timeoutMs: resolveImageGenerationTimeoutMs(input.size),
            method: 'POST',
            headers: { ...jsonAuthHeaders(token), Accept: 'text/event-stream' },
            body: JSON.stringify(input),
            ...(options?.signal ? { signal: options.signal } : {}),
          },
        );
      } catch (error) {
        throw normalizeArtifactsError('生成图片', error);
      }

      if (!response.ok) {
        const data = await readJsonErrorData<
          JsonErrorData & { error?: string | { message?: string } }
        >(response);
        throw new HttpError(
          buildArtifactsActionErrorMessage('生成图片', response.status, data),
          response.status,
          data,
        );
      }

      if (!response.body) {
        throw new Error('图片生成流式响应不可用。');
      }

      const parser = createSseFrameParser();
      const decoder = new TextDecoder();
      const dispatch = (frame: { data: string; event: string | null }): void => {
        if (frame.event !== 'partial' && frame.event !== 'done' && frame.event !== 'error') {
          return;
        }

        let payload: unknown;
        try {
          payload = JSON.parse(frame.data) as unknown;
        } catch {
          if (frame.event === 'error') {
            handlers.onError({
              code: 'stream_invalid_payload',
              message: '图片生成流式响应解析失败。',
              retryable: false,
            });
          }
          return;
        }

        if (frame.event === 'partial' && handlers.onPartial) {
          handlers.onPartial(payload as ImageGenerationPartialImage);
          return;
        }
        if (frame.event === 'done') {
          handlers.onDone(payload);
          return;
        }
        if (frame.event === 'error') {
          handlers.onError(payload as ImageGenerationStreamError);
        }
      };

      const reader = response.body.getReader();
      try {
        let finished = false;
        while (!finished) {
          const { done, value } = await reader.read();
          if (done) {
            finished = true;
            break;
          }
          for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
            dispatch(frame);
          }
        }
        for (const frame of parser.flush()) {
          dispatch(frame);
        }
      } catch (error) {
        throw normalizeArtifactsError('生成图片', error);
      } finally {
        reader.releaseLock();
      }
    },
  };
}
