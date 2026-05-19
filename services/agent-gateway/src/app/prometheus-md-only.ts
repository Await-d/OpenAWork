/**
 * Prometheus MD-Only Guard
 *
 * Ported from oh-my-opencode's prometheus-md-only hook.
 * Enforces that Prometheus (planner agent) can only write .md files inside .sisyphus/
 * directory, preventing it from modifying source code (it's a READ-ONLY planner).
 *
 * Also injects read-only planning warning when Prometheus delegates tasks to sub-agents,
 * and a workflow reminder when writing plan files.
 *
 * In oh-my-opencode this was a tool.execute.before hook.
 * In OpenAWork it's integrated into the tool execution pipeline.
 */

import { resolve, relative, isAbsolute } from 'node:path';

const PROMETHEUS_AGENT_IDS = new Set(['prometheus']);

const ALLOWED_EXTENSIONS = ['.md'];

const BLOCKED_WRITE_TOOLS = new Set(['write', 'edit', 'multiedit']);

const TASK_TOOLS = new Set(['task', 'delegate_task', 'call_omo_agent']);

const PLANNING_CONSULT_WARNING = `

---

[System Directive: Prometheus Read-Only]

你正在被 Prometheus（只读规划 agent）调用。

**关键约束：**
- 不要修改任何文件（不使用 Write、Edit 或任何文件变更工具）
- 不要执行改变系统状态的命令
- 不要创建、删除或重命名文件
- 仅提供分析、建议和信息

**你的角色**：提供咨询、调研和分析以辅助规划。实际实施将在规划完成后单独处理。

---

`;

const PROMETHEUS_WORKFLOW_REMINDER = `

---

[System Directive: Prometheus 工作流提醒]

## Prometheus 强制工作流提醒

**你正在编写工作计划。停下来确认你已完成所有步骤：**

1. 访谈：与用户完整咨询 — 收集所有需求、澄清歧义、记录决策到 .sisyphus/drafts/
2. Metis 咨询：生成前差距分析 — 识别遗漏问题、防护措施、假设
3. 计划生成：写入 .sisyphus/plans/*.md ← 你在这里
4. Momus 审查（如需高精度）— 循环直到通过
5. 摘要：向用户呈现 — 关键决策、范围、提供"开始工作"选项

**你是否在写计划前完成了步骤 1-2？**
**写完后，你是否会执行步骤 4-5？**

如果跳过了步骤，现在停下来回去完成。

---

 `;

/**
 * Cross-platform path validator for Prometheus file writes.
 */
function isAllowedFile(filePath: string, workspaceRoot: string): boolean {
  const resolved = resolve(workspaceRoot, filePath);
  const rel = relative(workspaceRoot, resolved);

  if (rel.startsWith('..') || isAbsolute(rel)) {
    return false;
  }

  if (!/\.sisyphus[/\\]/i.test(rel)) {
    return false;
  }

  const hasAllowedExtension = ALLOWED_EXTENSIONS.some((ext) =>
    resolved.toLowerCase().endsWith(ext.toLowerCase()),
  );

  return hasAllowedExtension;
}

export interface PrometheusGuardResult {
  blocked: boolean;
  blockMessage?: string;
  injectConsultWarning?: boolean;
  injectWorkflowReminder?: boolean;
}

/**
 * Check if a tool call from Prometheus should be blocked or modified.
 * Call this before executing write/edit tools for Prometheus agent.
 */
export function checkPrometheusToolGuard(input: {
  agentId: string;
  toolName: string;
  filePath?: string;
  prompt?: string;
  workspaceRoot: string;
}): PrometheusGuardResult {
  if (!PROMETHEUS_AGENT_IDS.has(input.agentId)) {
    return { blocked: false };
  }

  // Task delegation: inject read-only warning
  if (TASK_TOOLS.has(input.toolName.toLowerCase())) {
    if (input.prompt && !input.prompt.includes('[System Directive:')) {
      return { blocked: false, injectConsultWarning: true };
    }
    return { blocked: false };
  }

  // Write/edit tools: check path
  if (!BLOCKED_WRITE_TOOLS.has(input.toolName.toLowerCase())) {
    return { blocked: false };
  }

  if (!input.filePath) {
    return { blocked: false };
  }

  if (!isAllowedFile(input.filePath, input.workspaceRoot)) {
    return {
      blocked: true,
      blockMessage:
        `Prometheus 只能写入 .sisyphus/ 目录下的 .md 文件。` +
        `尝试修改: ${input.filePath}。` +
        `Prometheus 是只读规划者。使用 /start-work 来执行计划。` +
        `向用户道歉，提醒你的计划编写流程，告诉用户你将如何继续，然后编写计划。`,
    };
  }

  // Allowed path — check if it's a plan write for workflow reminder
  const normalizedPath = input.filePath.toLowerCase().replace(/\\/g, '/');
  if (normalizedPath.includes('.sisyphus/plans/')) {
    return { blocked: false, injectWorkflowReminder: true };
  }

  return { blocked: false };
}

export { PLANNING_CONSULT_WARNING, PROMETHEUS_WORKFLOW_REMINDER };
