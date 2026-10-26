/**
 * `/cron/jobs` 客户端：列表 + 新增 + 启停 + 立即运行 + 删除 + 历史。
 *
 * 网关的 `GET /cron/jobs` 返回**视图模型**（原始记录 + `scheduleDisplay` /
 * `status` / `fireCount` / `nextFireAt` 派生字段），与 `shared-ui` 的 `CronJob`
 * 一一对应；启停接口在 `PATCH`（通用字段更新）之外另有 `/enable` `/disable`
 * 幂等入口，这里统一走 `PATCH { enabled }`。
 */

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

export type CronScheduleKind = 'at' | 'every' | 'cron';
/**
 * 启停态。**不含 `running`**：`shared-ui` 的 `CronManager` 在 `status === 'running'`
 * 时会隐藏「启用 / 禁用」按钮，把运行中写进 status 会让长任务停不掉。
 */
export type CronJobStatus = 'enabled' | 'disabled';

export interface CronJobRecord {
  id: string;
  name: string;
  /** 调度类型（原始字段，gateway 的 `schedule_kind`）。 */
  schedule_kind: CronScheduleKind;
  schedule_at: number | null;
  schedule_every: number | null;
  schedule_expr: string | null;
  schedule_tz: string;
  prompt: string;
  enabled: boolean;
  delete_after_run: boolean;
  /** 结果投递方式；`none` 表示只执行、不主动送达（产出仍可从执行历史查看）。 */
  delivery_mode: 'none' | 'session' | 'desktop';
  /** `delivery_mode: 'session'` 的目标会话 id。 */
  delivery_target: string | null;
  last_fired_at: number | null;
  fire_count: number;
  /** 派生：与 `schedule_kind` 等值的驼峰别名（供 shared-ui 的 `CronJob` 消费）。 */
  scheduleKind: CronScheduleKind;
  /** 派生：人类可读的调度描述。 */
  scheduleDisplay: string;
  /**
   * 派生：只表达启停态。**不会是 `running`**——`shared-ui` 的 `CronManager`
   * 在 `running` 时会隐藏停用按钮，长任务将无法被停止；运行中信息见 `running`。
   */
  status: 'enabled' | 'disabled';
  /** 派生：该任务当前是否有一次执行在途（独立于 `status`，不影响按钮可用性）。 */
  running: boolean;
  /** 派生：与 `fire_count` 等值（供 shared-ui 的 `CronJob` 直接消费）。 */
  fireCount: number;
  /** 派生：与 `last_fired_at` 等值。 */
  lastFiredAt: number | null;
  /** 派生：下次触发时间（epoch 毫秒）；无法计算时为 `null`。 */
  nextFireAt: number | null;
  [key: string]: unknown;
}

/** 新增任务的入参（与网关 `POST /cron/jobs` 的 body 对齐）。 */
export interface CreateCronJobInput {
  name: string;
  schedule_kind: CronScheduleKind;
  prompt: string;
  schedule_at?: number | null;
  schedule_every?: number | null;
  schedule_expr?: string | null;
  schedule_tz?: string;
  agent_id?: string | null;
  model?: string | null;
  working_folder?: string | null;
  session_id?: string | null;
  delivery_mode?: 'desktop' | 'session' | 'none';
  delivery_target?: string | null;
  enabled?: boolean;
  delete_after_run?: boolean;
}

export interface CronExecutionRecord {
  id: string;
  job_id: string;
  started_at: number;
  finished_at: number | null;
  status: 'running' | 'completed' | 'failed';
  error?: string;
  /** 本次执行所用的会话 id；存在即可跳过去看完整现场。 */
  session_id?: string;
  /**
   * 该次执行的产出摘要（网关只对最近若干条生成）。
   *
   * `delivery_mode: 'none'` 的任务不会主动投递，摘要是用户在历史里
   * 直接读到「这次跑了什么」的唯一途径。
   */
  outputPreview?: string;
}

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
    patch: Partial<CreateCronJobInput>,
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
