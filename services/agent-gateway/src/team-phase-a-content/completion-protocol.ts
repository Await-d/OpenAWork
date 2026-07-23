/**
 * Executor / Reviewer 完成协议（Completion Protocol）内联常量。
 *
 * 注入位置：team-instruction-stack.ts 的 quality-gates 之后，仅对 executor / reviewer 角色生效。
 * 目的：确保完成协议始终在 system prompt 中可见，即使上下文压缩清除了初始 user 消息。
 *
 * 这是 pm1-runner.ts 中完成协议的精简版——只保留格式要求和自验证规则，
 * 不包含工具使用建议（那些在对话过程中已经不再需要）。
 */

const EXECUTOR_PROTOCOL = `## 完成协议（Executor）

结束前必须满足以下全部条件：

1. **至少调用过一次文件写入工具**（write / submit_patch / edit）
2. **输出实施摘要**，必须包含：
   - 修改了哪些文件
   - 核心实现逻辑
   - 如何验证
3. **自验证**——输出摘要前，自查：
   - 你的修改是否覆盖了任务描述中的每一条验收条件？
   - 是否有任务要求但你未实现的部分？
   - 如果有未覆盖项，在摘要中明确列出，不要声称已完成。

⚠️ 禁止只回复文字描述就结束——必须有实际工具调用产出。`;

const REVIEWER_PROTOCOL = `## 完成协议（Reviewer）

结束前必须满足以下全部条件：

1. **至少调用过一次文件读取工具**（read / list）
2. **输出结构化评审摘要**，必须包含：
   - 通过 / 不通过判定
   - 具体问题列表（含文件位置和行号）
   - 改进建议
3. **自验证**——输出摘要前，自查：
   - 你是否读取了所有相关代码文件？
   - 你的判定是否有具体证据支撑？

⚠️ 禁止只回复"已评审"或"看起来没问题"就结束——必须有具体的审查证据。`;

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
