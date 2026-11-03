/**
 * Task Resume Info
 *
 * Ported from oh-my-opencode's task-resume-info hook.
 * When a task/delegate_task tool returns a session ID in its output,
 * appends a "to continue" hint so the LLM knows how to resume the task later.
 *
 * In oh-my-opencode this was a tool.execute.after hook.
 * In OpenAWork it's integrated into executeToolCalls as a post-processing step.
 */

import { isTaskToolName } from './task-tools.js';

/**
 * 委派工具判定：规范名 `subagent` / 历史别名 `task` 统一走 `isTaskToolName()`。
 * 历史缺陷：这里按历史名枚举且缺 `subagent`，使 `subagent` 委派的输出不再追加
 * `to continue:` 恢复提示（同 `tools/sandbox/whitelist.ts` 的同类事故）。
 * `delegate_task` 是编排器委派别名，独立保留。
 */
const DELEGATION_TOOL_ALIASES = new Set(['delegate_task']);

function isResumeHintToolName(toolName: string): boolean {
  return isTaskToolName(toolName) || DELEGATION_TOOL_ALIASES.has(toolName);
}

const SESSION_ID_PATTERNS = [
  /Session ID: (ses_[a-zA-Z0-9_-]+)/,
  /session_id: (ses_[a-zA-Z0-9_-]+)/,
  /<task_metadata>\s*session_id: (ses_[a-zA-Z0-9_-]+)/,
  /sessionId: (ses_[a-zA-Z0-9_-]+)/,
];

function extractSessionId(output: string): string | null {
  for (const pattern of SESSION_ID_PATTERNS) {
    const match = output.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

/**
 * If the task tool output contains a session ID, append resume info.
 */
export function appendTaskResumeInfo(toolName: string, output: string): string {
  if (!isResumeHintToolName(toolName)) return output;
  if (output.startsWith('Error:') || output.startsWith('Failed')) return output;
  if (output.includes('\nto continue:')) return output;

  const sessionId = extractSessionId(output);
  if (!sessionId) return output;

  return (
    output.trimEnd() + `\n\nto continue: delegate_task(session_id="${sessionId}", prompt="...")`
  );
}
