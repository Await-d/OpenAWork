/** 现有 `/cron/jobs` HTTP 契约；时间统一为 Unix 毫秒，无服务端运行逻辑。 */
import type { z } from 'zod';
import type {
  cronExecutionStatusSchema,
  deliveryModeSchema,
  scheduleKindSchema,
  scheduledTaskCreateInputSchema,
  scheduledTaskHistoryOptionsSchema,
  scheduledTaskUpdateInputSchema,
} from './scheduled-tasks-validation.js';

export type ScheduleKind = z.infer<typeof scheduleKindSchema>;
export type DeliveryMode = z.infer<typeof deliveryModeSchema>;
export type CronExecutionStatus = z.infer<typeof cronExecutionStatusSchema>;
export type ScheduledTaskCreateInput = z.input<typeof scheduledTaskCreateInputSchema>;
export type ScheduledTaskUpdateInput = z.input<typeof scheduledTaskUpdateInputSchema>;
export type ScheduledTaskHistoryOptions = z.input<typeof scheduledTaskHistoryOptionsSchema>;

export interface ScheduledTaskDefinition {
  id: string;
  user_id: string;
  name: string;
  schedule_kind: ScheduleKind;
  schedule_at: number | null;
  schedule_every: number | null;
  schedule_expr: string | null;
  schedule_tz: string;
  prompt: string;
  agent_id: string | null;
  model: string | null;
  working_folder: string | null;
  session_id: string | null;
  delivery_mode: DeliveryMode;
  delivery_target: string | null;
  plugin_id: string | null;
  plugin_chat_id: string | null;
  enabled: boolean;
  delete_after_run: boolean;
  /** 历史存储列，执行链路没有迭代上限实现，不是可写配置。 */
  max_iterations: number;
  last_fired_at: number | null;
  fire_count: number;
  created_at: number;
  updated_at: number;
}

export interface ScheduledTaskExecution {
  id: string;
  job_id: string;
  started_at: number;
  finished_at: number | null;
  status: CronExecutionStatus;
  error?: string;
  session_id?: string;
  outputPreview?: string;
}

export interface ScheduledTaskView extends ScheduledTaskDefinition {
  scheduleKind: ScheduleKind;
  scheduleDisplay: string;
  /** 运行态独立于启停态，不影响停用按钮。 */
  status: 'enabled' | 'disabled';
  running: boolean;
  fireCount: number;
  lastFiredAt: number | null;
  nextFireAt: number | null;
  lastExecution: ScheduledTaskExecution | null;
}

export interface ScheduledTaskListResponse {
  jobs: ScheduledTaskView[];
}

export interface ScheduledTaskDetailResponse {
  job: ScheduledTaskView | null;
  ok?: boolean;
}

export interface ScheduledTaskHistoryResponse {
  history: ScheduledTaskExecution[];
}

export interface ScheduledTaskRunResponse {
  ok: true;
  jobId: string;
  executionId: string;
}

export interface ScheduledTaskErrorResponse {
  code: 'cron_job_not_found' | 'invalid_cron_job' | 'cron_job_busy';
  error: string;
  reason?: 'missing' | 'disabled' | 'in-flight' | 'busy';
  issues?: Array<{ message: string; path?: PropertyKey[] }>;
}
