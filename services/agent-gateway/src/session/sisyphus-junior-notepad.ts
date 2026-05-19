/**
 * Sisyphus Junior Notepad Directive
 *
 * Ported from oh-my-opencode's sisyphus-junior-notepad hook.
 * When an orchestrator agent (Atlas/Sisyphus) delegates tasks to sub-agents,
 * injects a notepad directive telling the sub-agent where to record learnings
 * and that the plan file is READ-ONLY.
 *
 * In oh-my-opencode this was a tool.execute.before hook on delegate_task.
 * In OpenAWork it's integrated into the task delegation prompt construction.
 */

const ORCHESTRATOR_AGENT_IDS = new Set(['atlas', 'sisyphus', 'zeus']);

export const NOTEPAD_DIRECTIVE = `
<Work_Context>
## 笔记位置（用于记录学习成果）
NOTEPAD PATH: .sisyphus/notepads/{plan-name}/
- learnings.md: 记录模式、约定、成功方法
- issues.md: 记录问题、阻碍、陷阱
- decisions.md: 记录架构选择和理由
- problems.md: 记录未解决问题、技术债

完成工作后应将发现追加到笔记文件。
重要：始终追加到笔记文件 — 不要覆盖或使用 Edit 工具。

## 计划位置（只读）
PLAN PATH: .sisyphus/plans/{plan-name}.md

关键规则：绝不修改计划文件

计划文件 (.sisyphus/plans/*.md) 是神圣且只读的。
- 你可以阅读计划以理解任务
- 你可以阅读复选框项以了解该做什么
- 你绝不能编辑、修改或更新计划文件
- 你绝不能在计划中将复选框标记为完成
- 只有编排者管理计划文件

违反 = 立即失败。编排者跟踪计划状态。
</Work_Context>
`;

/**
 * Check if the notepad directive should be injected for a delegation call.
 */
export function shouldInjectNotepadDirective(agentId: string, prompt: string): boolean {
  if (!ORCHESTRATOR_AGENT_IDS.has(agentId)) return false;
  if (!prompt) return false;
  if (prompt.includes('<Work_Context>')) return false;
  return true;
}
