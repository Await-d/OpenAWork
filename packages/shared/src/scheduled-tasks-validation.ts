/** `/cron/jobs` 的 wire 边界；调度可执行性与投递业务规则留在网关。 */
import { z } from 'zod';

export const scheduleKindSchema = z.enum(['at', 'every', 'cron']);
export const deliveryModeSchema = z.enum(['desktop', 'session', 'none', 'channel']);
export const cronExecutionStatusSchema = z.enum([
  'running',
  'completed',
  'failed',
  'skipped',
  'expired',
]);

/** 不带默认值，确保 PATCH 只更新显式字段；未知字段沿用既有 API 的 strip 语义。 */
const scheduledTaskFields = {
  name: z.string().min(1),
  schedule_kind: scheduleKindSchema,
  schedule_at: z.number().finite().nullable(),
  schedule_every: z.number().int().positive().nullable(),
  schedule_expr: z.string().nullable(),
  schedule_tz: z.string(),
  prompt: z.string().min(1),
  agent_id: z.string().nullable(),
  model: z.string().nullable(),
  working_folder: z.string().nullable(),
  session_id: z.string().nullable(),
  delivery_mode: deliveryModeSchema,
  delivery_target: z.string().nullable(),
  plugin_id: z.string().nullable(),
  plugin_chat_id: z.string().nullable(),
  enabled: z.boolean(),
  delete_after_run: z.boolean(),
};

export const scheduledTaskCreateInputSchema = z.object({
  ...scheduledTaskFields,
  schedule_at: scheduledTaskFields.schedule_at.default(null),
  schedule_every: scheduledTaskFields.schedule_every.default(null),
  schedule_expr: scheduledTaskFields.schedule_expr.default(null),
  schedule_tz: scheduledTaskFields.schedule_tz.default('UTC'),
  agent_id: scheduledTaskFields.agent_id.default(null),
  model: scheduledTaskFields.model.default(null),
  working_folder: scheduledTaskFields.working_folder.default(null),
  session_id: scheduledTaskFields.session_id.default(null),
  delivery_mode: scheduledTaskFields.delivery_mode.default('none'),
  delivery_target: scheduledTaskFields.delivery_target.default(null),
  plugin_id: scheduledTaskFields.plugin_id.default(null),
  plugin_chat_id: scheduledTaskFields.plugin_chat_id.default(null),
  enabled: scheduledTaskFields.enabled.default(true),
  delete_after_run: scheduledTaskFields.delete_after_run.default(false),
});

export const scheduledTaskUpdateInputSchema = z.object(scheduledTaskFields).partial();

export const scheduledTaskHistoryOptionsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100),
  preview: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => {
      if (value === undefined) return true;
      if (typeof value === 'boolean') return value;
      return value !== '0' && value.toLowerCase() !== 'false';
    }),
});
