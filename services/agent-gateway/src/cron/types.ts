export type ScheduleKind = 'at' | 'every' | 'cron';
export type DeliveryMode = 'desktop' | 'session' | 'none';

export interface CronJobRecord {
  id: string;
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
  max_iterations: number;
  last_fired_at: number | null;
  fire_count: number;
  created_at: number;
  updated_at: number;
}

export interface CronExecutionRecord {
  id: string;
  job_id: string;
  started_at: number;
  finished_at: number | null;
  status: 'running' | 'completed' | 'failed';
  error?: string;
  session_id?: string;
}

export type CronJobHandler = (job: CronJobRecord) => Promise<void>;
