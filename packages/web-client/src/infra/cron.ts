/**
 * `/cron/jobs` 客户端：列表 + 新增 + 启停 + 立即运行 + 删除 + 历史。
 *
 * 网关的 `GET /cron/jobs` 返回**视图模型**（原始记录 + `scheduleDisplay` /
 * `status` / `fireCount` / `nextFireAt` 派生字段），与 `shared-ui` 的 `CronJob`
 * 一一对应；启停接口在 `PATCH`（通用字段更新）之外另有 `/enable` `/disable`
 * 幂等入口，这里统一走 `PATCH { enabled }`。
 */

import type {
  DeliveryMode,
  ScheduleKind,
  ScheduledTaskCreateInput,
  ScheduledTaskExecution,
  ScheduledTaskUpdateInput,
  ScheduledTaskView,
} from '@openAwork/shared';
import {
  authHeader,
  fetchWithTimeout,
  extractJsonErrorMessage,
  HttpError,
  isGenericFetchErrorMessage,
  jsonAuthHeaders,
  readJsonErrorData,
  type JsonErrorData,
} from '../gateway/http.js';

export type CronScheduleKind = ScheduleKind;
/** 启停态与运行态分离，运行中仍能停用任务。 */
export type CronJobStatus = ScheduledTaskView['status'];

type BrowserCronDeliveryMode = Extract<DeliveryMode, 'none' | 'session' | 'desktop'>;

/** 保留既有浏览器视图字段集合，字段定义由共享 wire 契约提供。 */
export interface CronJobRecord extends Pick<
  ScheduledTaskView,
  | 'id'
  | 'name'
  | 'schedule_kind'
  | 'schedule_at'
  | 'schedule_every'
  | 'schedule_expr'
  | 'schedule_tz'
  | 'prompt'
  | 'enabled'
  | 'delete_after_run'
  | 'delivery_target'
  | 'last_fired_at'
  | 'fire_count'
  | 'scheduleKind'
  | 'scheduleDisplay'
  | 'status'
  | 'running'
  | 'fireCount'
  | 'lastFiredAt'
  | 'nextFireAt'
  | 'lastExecution'
> {
  delivery_mode: DeliveryMode;
  [key: string]: unknown;
}

/** 保持浏览器已有的投递范围；渠道配置由渠道管理入口处理。 */
export type CreateCronJobInput = Omit<ScheduledTaskCreateInput, 'delivery_mode'> & {
  delivery_mode?: BrowserCronDeliveryMode;
};

export type CronExecutionRecord = ScheduledTaskExecution;

export interface CronJobsResponse {
  jobs: CronJobRecord[];
}

/** 拉执行历史的可选参数。 */
export interface CronHistoryOptions {
  /** 最多返回多少条；默认 100。 */
  readonly limit?: number;
  /**
   * 是否让服务端补齐 `outputPreview`（产出摘要），默认 `true`。
   *
   * 摘要要**逐个执行会话读取消息**，成本远高于查执行表本身。列表页刷新时会对
   * 每个任务调一次 history，只为拿最新一条判「上次是否失败」——那种场景必须传
   * `false`，否则 10 个任务会放大成 50 次会话消息读取。
   */
  readonly includePreview?: boolean;
}

export interface CronClient {
  list(token: string, options?: { signal?: AbortSignal }): Promise<CronJobRecord[]>;
  create(token: string, input: CreateCronJobInput): Promise<CronJobRecord>;
  setEnabled(token: string, jobId: string, enabled: boolean): Promise<CronJobRecord | null>;
  runNow(token: string, jobId: string): Promise<void>;
  remove(token: string, jobId: string): Promise<void>;
  history(
    token: string,
    jobId: string,
    options?: CronHistoryOptions,
  ): Promise<CronExecutionRecord[]>;
  /** 局部修改任务（当前用于切换投递方式）。 */
  update(
    token: string,
    jobId: string,
    patch: Omit<ScheduledTaskUpdateInput, 'delivery_mode'> & {
      delivery_mode?: BrowserCronDeliveryMode;
    },
  ): Promise<CronJobRecord | null>;
}

type CronActionLabel = string;

function buildCronActionErrorMessage(
  actionLabel: CronActionLabel,
  status: number,
  data: JsonErrorData | undefined,
): string {
  // 400 优先透出 zod issues 的具体原因（网关的 `error` 字段只有笼统文案
  // 「定时任务配置无效。」，对用户排查表达式毫无帮助）。
  if (status === 400) {
    const issues = (data as { issues?: unknown } | undefined)?.issues;
    if (Array.isArray(issues) && issues.length > 0) {
      const first = issues[0] as { message?: unknown } | undefined;
      if (first && typeof first.message === 'string' && first.message.length > 0) {
        return `定时任务配置无效：${first.message}`;
      }
    }
  }
  const extracted = extractJsonErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 400) {
    return '定时任务配置无效（请检查调度表达式与必填字段）。';
  }
  if (status === 401 || status === 403) {
    return `认证失效或当前账号无权${actionLabel}。`;
  }
  if (status === 404) {
    return `目标定时任务不存在，无法${actionLabel}。`;
  }
  if (status === 409) {
    return `当前状态不允许${actionLabel}。`;
  }
  return `${actionLabel}失败（HTTP ${status}）。`;
}

function isGenericCronNetworkErrorMessage(message: string): boolean {
  return isGenericFetchErrorMessage(message);
}

function normalizeCronError(actionLabel: CronActionLabel, error: unknown): Error {
  if (error instanceof HttpError) {
    // 「请求失败」路径抛出的 `HttpError` 文案已经是 `buildCronActionErrorMessage`
    // 的产物（可能来自 zod issues），**不要**在这里用 `extractJsonErrorMessage`
    // 再覆盖一次——那会把具体的 issues 原因退化成笼统的 `error` 字段。
    if (error.message.trim().length > 0) {
      return error;
    }
    return new HttpError(
      buildCronActionErrorMessage(actionLabel, error.status, undefined),
      error.status,
      error.data,
    );
  }
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0 && !isGenericCronNetworkErrorMessage(message)) {
      return error;
    }
  }
  return new Error(`网络异常，${actionLabel}失败。`);
}

async function performCronRequest<T>(input: {
  actionLabel: CronActionLabel;
  parseJson?: boolean;
  request: () => Promise<Response>;
}): Promise<T> {
  try {
    const response = await input.request();
    if (!response.ok) {
      const data = await readJsonErrorData<JsonErrorData>(response);
      throw new HttpError(
        buildCronActionErrorMessage(input.actionLabel, response.status, data),
        response.status,
        data,
      );
    }
    if (input.parseJson === false || response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  } catch (error) {
    throw normalizeCronError(input.actionLabel, error);
  }
}

export function createCronClient(baseUrl: string): CronClient {
  return {
    async list(token, options) {
      const data = await performCronRequest<CronJobsResponse>({
        actionLabel: '读取定时任务列表',
        request: () =>
          fetchWithTimeout(`${baseUrl}/cron/jobs`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
      return data.jobs ?? [];
    },

    async create(token, input) {
      const data = await performCronRequest<{ job: CronJobRecord }>({
        actionLabel: '创建定时任务',
        request: () =>
          fetchWithTimeout(`${baseUrl}/cron/jobs`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(input),
          }),
      });
      return data.job;
    },

    async setEnabled(token, jobId, enabled) {
      const data = await performCronRequest<{ job?: CronJobRecord | null }>({
        actionLabel: enabled ? '启用定时任务' : '停用定时任务',
        request: () =>
          fetchWithTimeout(`${baseUrl}/cron/jobs/${encodeURIComponent(jobId)}`, {
            method: 'PATCH',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify({ enabled }),
          }),
      });
      return data.job ?? null;
    },

    async update(token, jobId, patch) {
      const data = await performCronRequest<{ job?: CronJobRecord | null }>({
        actionLabel: '修改定时任务',
        request: () =>
          fetchWithTimeout(`${baseUrl}/cron/jobs/${encodeURIComponent(jobId)}`, {
            method: 'PATCH',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(patch),
          }),
      });
      return data.job ?? null;
    },

    async runNow(token, jobId) {
      await performCronRequest({
        actionLabel: '立即运行定时任务',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/cron/jobs/${encodeURIComponent(jobId)}/run`, {
            method: 'POST',
            headers: authHeader(token),
          }),
      });
    },

    async remove(token, jobId) {
      await performCronRequest({
        actionLabel: '删除定时任务',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/cron/jobs/${encodeURIComponent(jobId)}`, {
            method: 'DELETE',
            headers: authHeader(token),
          }),
      });
    },

    async history(token, jobId, options) {
      const query = new URLSearchParams();
      if (options?.limit !== undefined) query.set('limit', String(options.limit));
      if (options?.includePreview === false) query.set('preview', '0');
      const suffix = query.size > 0 ? `?${query.toString()}` : '';
      const data = await performCronRequest<{ history: CronExecutionRecord[] }>({
        actionLabel: '读取执行历史',
        request: () =>
          fetchWithTimeout(`${baseUrl}/cron/jobs/${encodeURIComponent(jobId)}/history${suffix}`, {
            headers: authHeader(token),
          }),
      });
      return data.history ?? [];
    },
  };
}
