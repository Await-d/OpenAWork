export type ScheduleKind = 'at' | 'every' | 'cron';
export type DeliveryMode = 'desktop' | 'session' | 'none';

export interface CronJobRecord {
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
  /**
   * 历史列（表结构保留）。执行链路没有对应的迭代上限实现，已从 HTTP / 工具入参
   * 移除——不要再把它当可用配置，也不要新增读取点。
   */
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
  /**
   * `skipped`：本次**到点触发**被跳过（上一次执行未结束 / 并发上限已满）。
   *
   * 以前这两种情况是静默 return：任务看起来「一直没跑」，历史里空无一物，
   * 用户无从判断是没到点、被跳过、还是执行失败。跳过记录按任务每分钟最多
   * 落一条，避免高频任务刷满历史。
   */
  status: 'running' | 'completed' | 'failed' | 'skipped';
  error?: string;
  session_id?: string;
}

/**
 * 执行上下文：handler 建好「本次执行会话」后回调，调度器据此把 `session_id`
 * 写进执行历史。
 *
 * 为什么需要：历史里本来就有 `session_id` 列，但此前从未写入，于是
 * `delivery_mode: 'none'` 的任务跑完之后，用户**没有任何入口**找到产出
 * （产出确实写进了 `cron:<任务名>` 会话，但界面上没有任何指针指向它）。
 * 这个回调让「执行历史 → 执行现场」成为一条可点的链路。
 *
 * 必须在**真正开始执行之前**调用（失败路径也要能记录现场）。
 */
export interface CronJobExecutionContext {
  reportSession(sessionId: string): void;
}

export type CronJobHandler = (
  job: CronJobRecord,
  context?: CronJobExecutionContext,
) => Promise<void>;
