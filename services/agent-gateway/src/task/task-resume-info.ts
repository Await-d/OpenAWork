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

const TARGET_TOOLS = new Set(['task', 'Task', 'delegate_task', 'call_omo_agent']);

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
  if (!TARGET_TOOLS.has(toolName)) return output;
  if (output.startsWith('Error:') || output.startsWith('Failed')) return output;
  if (output.includes('\nto continue:')) return output;

  const sessionId = extractSessionId(output);
  if (!sessionId) return output;

  return (
    output.trimEnd() + `\n\nto continue: delegate_task(session_id="${sessionId}", prompt="...")`
  );
}
