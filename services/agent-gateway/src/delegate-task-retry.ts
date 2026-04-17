/**
 * Delegate Task Retry
 *
 * Ported from oh-my-opencode's delegate-task-retry hook.
 * When the task/delegate_task tool returns an error, detect the error pattern
 * and append retry guidance to the tool output so the LLM can self-correct.
 *
 * In oh-my-opencode this was a tool.execute.after hook.
 * In OpenAWork it's integrated into executeToolCalls as a post-processing step.
 */

export interface DelegateTaskErrorPattern {
  pattern: string;
  errorType: string;
  fixHint: string;
}

export const DELEGATE_TASK_ERROR_PATTERNS: DelegateTaskErrorPattern[] = [
  {
    pattern: 'run_in_background',
    errorType: 'missing_run_in_background',
    fixHint: '添加 run_in_background=false（委派）或 run_in_background=true（并行探索）',
  },
  {
    pattern: 'load_skills',
    errorType: 'missing_load_skills',
    fixHint:
      '添加 load_skills=[] 参数（如无技能需要则空数组）。注意：调用 Skill 工具不会填充此参数。',
  },
  {
    pattern: 'category OR subagent_type',
    errorType: 'mutual_exclusion',
    fixHint:
      '仅提供以下之一：category（如 "general", "quick"）或 subagent_type（如 "oracle", "explore"）',
  },
  {
    pattern: 'Must provide either category or subagent_type',
    errorType: 'missing_category_or_agent',
    fixHint: '添加 category="general" 或 subagent_type="explore"',
  },
  {
    pattern: 'Unknown category',
    errorType: 'unknown_category',
    fixHint: '使用错误消息中的可用列表中的有效 category',
  },
  {
    pattern: 'Agent name cannot be empty',
    errorType: 'empty_agent',
    fixHint: '提供非空的 subagent_type 值',
  },
  {
    pattern: 'Unknown agent',
    errorType: 'unknown_agent',
    fixHint: '使用错误消息中的可用列表中的有效 agent',
  },
  {
    pattern: 'Cannot call primary agent',
    errorType: 'primary_agent',
    fixHint:
      '主 agent 不能通过 delegate_task 调用。使用子 agent 如 "explore"、"oracle"、"librarian"',
  },
  {
    pattern: 'Skills not found',
    errorType: 'unknown_skills',
    fixHint: '使用错误消息中的可用列表中的有效 skill 名称',
  },
];

export interface DetectedError {
  errorType: string;
  originalOutput: string;
}

export function detectDelegateTaskError(output: string): DetectedError | null {
  if (!output.includes('[ERROR]') && !output.includes('Invalid arguments')) return null;

  for (const errorPattern of DELEGATE_TASK_ERROR_PATTERNS) {
    if (output.includes(errorPattern.pattern)) {
      return {
        errorType: errorPattern.errorType,
        originalOutput: output,
      };
    }
  }

  return null;
}

function extractAvailableList(output: string): string | null {
  const availableMatch = output.match(/Available[^:]*:\s*(.+)$/m);
  return availableMatch?.[1]?.trim() ?? null;
}

export function buildRetryGuidance(errorInfo: DetectedError): string {
  const pattern = DELEGATE_TASK_ERROR_PATTERNS.find((p) => p.errorType === errorInfo.errorType);

  if (!pattern) {
    return `[delegate_task 错误] 修复错误后使用正确参数重试。`;
  }

  const fixHint = pattern.fixHint;
  let guidance = `
[delegate_task 调用失败 — 需立即重试]

**错误类型**: ${errorInfo.errorType}
**修复方法**: ${fixHint}`;

  const availableList = extractAvailableList(errorInfo.originalOutput);
  if (availableList) {
    guidance += `\n**可用选项**: ${availableList}`;
  }

  guidance += `

**动作**: 立即使用修正后的参数重试 delegate_task。

正确调用示例：
\`\`\`
delegate_task(
  description="任务描述",
  prompt="详细提示...",
  category="general",  // 或 subagent_type="explore"
  run_in_background=false,
  load_skills=[]
)
\`\`\``;

  return guidance;
}
