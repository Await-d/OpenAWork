import { sqliteRun } from '../infra/db.js';

/**
 * 父会话上下文存储。
 *
 * **历史**：本文件的前身是 `task-parent-auto-resume.ts`——它曾承载「子代理完成后
 * **伪造用户请求**回流父会话 + 800/1500ms 定时重试 + 连续回流计数」的整套机制。
 * 该机制已随**单通道交付**退役：
 *   - 交付：`task/task-job-delivery.ts` 的 `deliverTaskCompletion`（幂等入库 + 纯函数决策 + 唤醒）
 *   - 唤醒：`routes/stream-runtime.ts` 的 `continueSessionFromHistory`
 *   - 恢复：`task/task-job-recovery.ts` 的 `recoverPendingTaskDeliveries`
 * 因此原模块的 drain / schedule / consume / clear / 计数 / 请求键判定**均已删除**。
 *
 * **保留原因（仍在使用）**：这张上下文表被 `task/task-parent-auto-decision.ts` 消费——
 * 子代理中途停下（待批准 / 待回答）时，父代理需要父会话的**原始请求数据**来替它构造一次
 * 父级决策请求。因此这里只保留写入侧。
 *
 * ⚠️ 表名 `task_parent_auto_resume_contexts` 属历史遗留（改名需迁移 + 改 2 处消费方 SQL），
 * 语义应以本文件为准。
 */

export interface TaskParentContextInput {
  childSessionId: string;
  parentSessionId: string;
  requestData: Record<string, unknown>;
  taskId: string;
  userId: string;
}

/** 写入 / 更新父会话上下文（按 `child_session_id` 唯一）。 */
export function upsertTaskParentContext(input: TaskParentContextInput): void {
  sqliteRun(
    `INSERT INTO task_parent_auto_resume_contexts
      (child_session_id, parent_session_id, user_id, task_id, request_data_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(child_session_id) DO UPDATE SET
       parent_session_id = excluded.parent_session_id,
       user_id = excluded.user_id,
       task_id = excluded.task_id,
       request_data_json = excluded.request_data_json,
       updated_at = datetime('now')`,
    [
      input.childSessionId,
      input.parentSessionId,
      input.userId,
      input.taskId,
      JSON.stringify(input.requestData),
    ],
  );
}

/** 清理某子会话的父上下文（子会话删除 / 结算时调用）。 */
export function clearTaskParentContext(input: { childSessionId: string; userId: string }): void {
  sqliteRun(
    'DELETE FROM task_parent_auto_resume_contexts WHERE child_session_id = ? AND user_id = ?',
    [input.childSessionId, input.userId],
  );
}
