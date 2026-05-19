/**
 * Empty Task Response Detector
 *
 * Ported from oh-my-opencode's empty-task-response-detector hook.
 * Detects when the task tool returns an empty response and appends a warning
 * so the LLM knows the task didn't produce output (rather than assuming success).
 *
 * In oh-my-opencode this was a tool.execute.after hook.
 * In OpenAWork it's integrated into executeToolCalls as a post-processing step.
 */

const EMPTY_TASK_RESPONSE_WARNING = `[任务空响应警告]

任务调用已完成但未返回响应。这表明 agent 可能：
- 未能正确执行
- 未正确终止
- 返回了空结果

注意：调用已完成 — 你不是在等待响应。请据此继续工作。`;

/**
 * Check if a task tool result is empty and return a warning if so.
 */
export function detectEmptyTaskResponse(toolName: string, output: string): string {
  if (toolName !== 'task' && toolName !== 'Task') return output;

  const trimmed = output?.trim() ?? '';
  if (trimmed === '') {
    return EMPTY_TASK_RESPONSE_WARNING;
  }

  return output;
}
