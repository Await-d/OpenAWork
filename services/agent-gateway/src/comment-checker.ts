/**
 * Comment Checker
 *
 * Ported from oh-my-opencode's comment-checker hook.
 * Detects AI-generated comments in write/edit tool output and appends a warning.
 * Unlike oh-my-opencode which uses a separate CLI binary, this is a lightweight
 * regex-based check that runs inline.
 *
 * In oh-my-opencode this was a tool.execute.before + tool.execute.after hook pair.
 * In OpenAWork it's integrated into executeToolCalls as a post-processing step.
 */

const AI_COMMENT_PATTERNS = [
  // AI-generated section comments
  /\/\/\s*(Added|Modified|Updated|Created|Removed|Deleted|Fixed|Implemented|Refactored)\s+(by\s+)?AI/i,
  /\/\/\s*AI\s+(generated|assisted|suggested|wrote)/i,
  /\/\/\s*Auto-generated/i,
  /\/\/\s*TODO:\s*AI/i,
  /#\s*(Added|Modified|Updated|Created|Removed|Deleted|Fixed|Implemented|Refactored)\s+(by\s+)?AI/i,
  /#\s*AI\s+(generated|assisted|suggested|wrote)/i,
  /#\s*Auto-generated/i,
  // Generic "I added/changed" comments that AI tends to write
  /\/\/\s*I\s+(added|modified|updated|created|removed|deleted|fixed|implemented|refactored)/i,
  /\/\/\s*This\s+(function|method|class|module|file)\s+(was|is)\s+(added|modified|updated|created)/i,
  // Overly descriptive block comments on simple code
  /\/\*\*[\s\S]*?(function|method|class)\s+(does|performs|handles|processes|creates|returns|checks|validates)/i,
];

const COMMENT_CHECKER_WARNING = `

[注释质量提醒]
检测到可能的 AI 生成注释。请审查：
- 删除纯描述性注释（代码应自解释）
- 保留解释"为什么"的注释，删除解释"做什么"的注释
- 不要添加 "Added by AI" 或 "Auto-generated" 标记
- 不要添加 "I added/modified/updated" 第一人称注释
- 如用户明确要求注释则保留`;

/**
 * Check tool output for AI-generated comments and return warning if found.
 * Only checks write/edit tool results. Handles both string and structured output.
 */
export function checkAiComments(toolName: string, output: unknown): unknown {
  const toolLower = toolName.toLowerCase();
  if (toolLower !== 'write' && toolLower !== 'edit' && toolLower !== 'multiedit') {
    return output;
  }

  // Extract the file content to check
  let contentToCheck: string | null = null;

  if (typeof output === 'string') {
    if (output.startsWith('Error:') || output.startsWith('Failed')) return output;
    contentToCheck = output;
  } else if (output && typeof output === 'object') {
    const obj = output as Record<string, unknown>;
    // write/edit tools return { after: string, ... }
    if (typeof obj['after'] === 'string') {
      contentToCheck = obj['after'];
    }
  }

  if (!contentToCheck) return output;

  for (const pattern of AI_COMMENT_PATTERNS) {
    if (pattern.test(contentToCheck)) {
      // Append warning — for string output, append directly; for objects, add a warning field
      if (typeof output === 'string') {
        return output + COMMENT_CHECKER_WARNING;
      }
      // For structured output, add a _commentWarning field that buildToolResultContent will stringify
      return {
        ...(output as Record<string, unknown>),
        _commentWarning: COMMENT_CHECKER_WARNING.trim(),
      };
    }
  }

  return output;
}
