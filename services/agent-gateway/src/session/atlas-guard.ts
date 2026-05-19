/**
 * Atlas Guard
 *
 * Ported from oh-my-opencode's atlas hook.
 * Enforces orchestrator protocol for Atlas/Zeus/Sisyphus agents:
 * 1. Blocks orchestrators from writing outside .sisyphus/ (except for verification)
 * 2. Injects single-task directive when delegating via delegate_task
 * 3. Appends verification reminder after delegate_task completes
 * 4. Appends boulder progress + orchestrator reminder when boulder state exists
 *
 * In oh-my-opencode this was a complex event-driven hook.
 * In OpenAWork it's split into pre-execution checks and post-processing steps.
 */

import {
  readBoulderState,
  appendSessionId,
  getPlanProgress,
  type PlanProgress,
} from './boulder-state.js';

const ORCHESTRATOR_AGENT_IDS = new Set(['atlas', 'zeus', 'sisyphus']);

const WRITE_EDIT_TOOLS = new Set(['write', 'edit', 'multiedit']);

/**
 * Cross-platform check if a path is inside .sisyphus/ directory.
 */
function isSisyphusPath(filePath: string): boolean {
  return /\.sisyphus[/\\]/.test(filePath);
}

// --- Pre-execution directives ---

export const SINGLE_TASK_DIRECTIVE = `
[System Directive: 单任务约束]

**停止。阅读此内容后再继续。**

如果你收到的不是**恰好一个原子任务**，你必须：
1. **立即拒绝**此请求
2. **要求**编排者提供一个单一的、具体的任务

**如果你检测到多个任务，请这样回复：**
> 我拒绝继续。你提供了多个任务。编排者的急躁会破坏工作质量。
> 请提供恰好一个任务。一个文件。一个变更。一次验证。
> 你的仓促会导致：不完整的工作、遗漏的边界情况、失败的测试、浪费的上下文。

**拒绝多任务请求。要求单任务清晰度。**
`;

export const ORCHESTRATOR_DELEGATION_REQUIRED = (filePath: string) => `
---

[System Directive: 委派必需]

**停止。你正在违反编排者协议。**

你（编排者）正在尝试直接修改 \`.sisyphus/\` 之外的文件。

**尝试路径：** ${filePath}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**这是被禁止的**（除非用于验证目的）

作为编排者，你必须：
1. **委派**所有实现工作，通过 \`delegate_task\`
2. **验证**子代理完成的工作（读取文件是允许的）
3. **协调** — 你编排，你不实现

**允许的直接文件操作：**
- \`.sisyphus/\` 内的文件（计划、笔记、草稿）
- 读取文件进行验证
- 运行诊断/测试

**禁止的直接文件操作：**
- 写入/编辑源代码
- 在 \`.sisyphus/\` 外创建新文件
- 任何实现工作

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**正确方法：**
\`\`\`
delegate_task(
  category="...",
  prompt="[具体的单一任务，带有明确的验收标准]"
)
\`\`\`

委派。不要实现。

---
`;

// --- Post-execution reminders ---

const VERIFICATION_REMINDER = `**强制：你现在必须做什么**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

关键：子代理经常在完成情况上说谎。
测试失败、代码有错误、实现不完整 — 但他们说"完成"。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**步骤 1：用你自己的工具调用验证（现在就做）**

自己运行这些命令 — 不要信任代理的声明：
1. 对变更文件运行 \`lsp_diagnostics\` → 必须干净
2. 运行 \`bash\` 执行测试 → 必须通过
3. 运行 \`bash\` 执行构建/类型检查 → 必须成功
4. \`Read\` 实际代码 → 必须匹配需求

**步骤 2：标记完成（立即）**

验证通过 → 立即标记。不要延迟。
更新计划文件中的复选框 \`[ ]\` → \`[x]\`。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

const DIRECT_WORK_REMINDER = `
---

[System Directive: 委派必需]

你刚刚在 \`.sisyphus/\` 之外执行了直接文件修改。

**你是编排者，不是实现者。**

作为编排者，你应该：
- **委派**实现工作给子代理，通过 \`delegate_task\`
- **验证**子代理完成的工作
- **协调**多个任务并确保完成

你不应该：
- 直接编写代码（\`.sisyphus/\` 文件如计划和笔记除外）
- 在 \`.sisyphus/\` 外直接编辑文件
- 自己实现功能

---
`;

function buildOrchestratorReminder(planName: string, progress: PlanProgress): string {
  const remaining = progress.total - progress.completed;
  return `
---

**巨石状态：** 计划: \`${planName}\` | ${progress.completed}/${progress.total} 完成 | ${remaining} 剩余

---

${VERIFICATION_REMINDER}

**${remaining} 个任务剩余。继续推石头。**
`;
}

function buildStandaloneVerificationReminder(): string {
  return `
---

${VERIFICATION_REMINDER}

---
`;
}

// --- Public API ---

export interface AtlasGuardResult {
  /** Whether to inject single-task directive into delegate_task prompt */
  injectSingleTaskDirective: boolean;
  /** Whether to inject delegation-required warning for write/edit */
  injectDelegationWarning: boolean;
  /** The file path that triggered the delegation warning */
  delegationWarningFilePath?: string;
}

/**
 * Pre-execution check for orchestrator agents.
 * Call this before executing write/edit or delegate_task tools.
 */
export function checkAtlasGuard(input: {
  agentId: string;
  toolName: string;
  filePath?: string;
  prompt?: string;
}): AtlasGuardResult {
  if (!ORCHESTRATOR_AGENT_IDS.has(input.agentId)) {
    return { injectSingleTaskDirective: false, injectDelegationWarning: false };
  }

  // Write/edit tools: check if outside .sisyphus/
  if (WRITE_EDIT_TOOLS.has(input.toolName.toLowerCase())) {
    const filePath = input.filePath ?? '';
    if (filePath && !isSisyphusPath(filePath)) {
      return {
        injectSingleTaskDirective: false,
        injectDelegationWarning: true,
        delegationWarningFilePath: filePath,
      };
    }
  }

  // delegate_task: inject single-task directive
  if (input.toolName === 'delegate_task' || input.toolName === 'task') {
    if (input.prompt && !input.prompt.includes('[System Directive: 单任务约束]')) {
      return { injectSingleTaskDirective: true, injectDelegationWarning: false };
    }
  }

  return { injectSingleTaskDirective: false, injectDelegationWarning: false };
}

/**
 * Post-execution: build the reminder to append after delegate_task completes.
 * Returns the reminder string or empty string.
 */
export async function buildAtlasPostProcessReminder(input: {
  agentId: string;
  toolName: string;
  sessionId: string;
  workspaceRoot: string;
}): Promise<string> {
  if (!ORCHESTRATOR_AGENT_IDS.has(input.agentId)) return '';

  const toolLower = input.toolName.toLowerCase();

  // Write/edit outside .sisyphus/: append direct-work reminder
  if (WRITE_EDIT_TOOLS.has(toolLower)) {
    // We don't have the filePath here; the pre-check already injected the warning
    // For post-processing, we just append a generic reminder
    return DIRECT_WORK_REMINDER;
  }

  // delegate_task: append verification + boulder progress
  if (toolLower === 'delegate_task' || toolLower === 'task') {
    const boulderState = await readBoulderState(input.workspaceRoot);

    if (boulderState) {
      // Append session to boulder if not already tracked
      if (!boulderState.session_ids.includes(input.sessionId)) {
        await appendSessionId(input.workspaceRoot, input.sessionId);
      }

      const progress = await getPlanProgress(boulderState.active_plan);
      return buildOrchestratorReminder(boulderState.plan_name, progress);
    }

    return buildStandaloneVerificationReminder();
  }

  return '';
}
