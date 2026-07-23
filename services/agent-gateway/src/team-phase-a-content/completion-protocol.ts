/**
 * Executor / Reviewer 完成协议（Completion Protocol）内联常量。
 *
 * 注入位置：team-instruction-stack.ts 的 quality-gates 之后，仅对 executor / reviewer 角色生效。
 * 目的：确保完成协议始终在 system prompt 中可见，即使上下文压缩清除了初始 user 消息。
 */

const EXECUTOR_PROTOCOL = `## 完成协议（Executor）

结束前必须满足：

1. **至少调用过一次文件写入工具**（write / submit_patch / edit）
2. **必须调用 submit_execution_result**（硬契约），提交：
   - taskId
   - status: completed | blocked | failed
   - changedFiles
   - checklist: [{ id, status: pass|fail|blocked, evidence }]
   - summary / verification
3. **自验证**：checklist 必须覆盖任务验收条件；未覆盖项标 fail/blocked，不要假 pass。

⚠️ 只回复文字或只 mark_completed **不算完成**。没有 submit_execution_result，runner 在 hard 模式下会判定 execution-protocol-failure。`;

const REVIEWER_PROTOCOL = `## 完成协议（Reviewer）

结束前必须满足：

1. **至少调用过一次文件读取工具**（read / list）
2. **必须调用 submit_review**（硬契约），提交：
   - taskId（可选但推荐）
   - verdict: pass | fail（或兼容 decision）
   - items: [{ id, status: pass|fail, reason?, fileRefs? }]
   - overallReason / title / content（可选展示）
3. **自验证**：判定必须有证据；verdict=pass 时 items 不得含 fail。

⚠️ 只回复“已评审”或只 mark_completed **不算完成**。`;

export function getCompletionProtocolMd(roleLayer: string): string | null {
  switch (roleLayer) {
    case 'executor':
      return EXECUTOR_PROTOCOL;
    case 'reviewer':
      return REVIEWER_PROTOCOL;
    default:
      return null;
  }
}
