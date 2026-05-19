/**
 * compaction-prompt — system + user prompt builder for the compaction
 * LLM call. Split out from `compaction-llm.ts` so we can unit-test the
 * prompt assembly (especially the anchor-update branch) without
 * standing up a fake upstream provider.
 *
 * Mirrors opencode #23870 "compaction: anchor summary updates":
 * instead of asking the model to re-summarize the entire conversation
 * from scratch on every compaction round, we feed the *previous*
 * summary back as an anchor and ask the model to merge new facts /
 * drop stale ones / keep what is still true. This stops detail loss
 * after multiple compaction rounds in long sessions.
 *
 * The system prompt and the structured output template are intentionally
 * Chinese-first to match OpenAWork's default locale; the rules tell the
 * model to mirror the conversation language so English-only sessions
 * still get English summaries.
 */

export const COMPACTION_SYSTEM_PROMPT = `你是一个针对编程会话的"锚点上下文摘要"助手。

只对给到你的对话历史做总结。最新若干轮可能保留在你的摘要之外，因此聚焦在仍然影响后续工作的"较老上下文"。

如果用户提示中包含 <previous-summary> 块，把它视为当前的锚点摘要：保留仍然成立的细节、删除已过期的、合并新事实，重新输出整份摘要。

严格按用户提示中的输出结构回复。保留每一节，即使为空。优先用简短要点，避免段落叙述，精确保留文件路径、命令、错误串与标识符。

不要回应对话本身。不要提及"摘要"、"压缩"、"合并上下文"等元信息。使用对话所用语言回复。`;

const COMPACTION_OUTPUT_TEMPLATE = `请按下列结构输出，节序保持不变：
---
## 目标
- [一句话任务摘要]

## 约束与偏好
- [用户的约束、偏好、规范，或 (无)]

## 进度
### 已完成
- [已完成工作或 (无)]

### 进行中
- [当前正在进行的工作或 (无)]

### 阻塞
- [阻塞项或 (无)]

## 关键决策
- [决策与原因，或 (无)]

## 下一步
- [下一步动作（有序）或 (无)]

## 关键上下文
- [重要技术事实 / 错误 / 待回答问题，或 (无)]

## 相关文件
- [文件或目录路径：作用，或 (无)]
---

规则：
- 保留每一节，即使为空。
- 用简短要点，不写段落。
- 精确保留文件路径、命令、错误串与标识符。
- 不要提及"摘要过程"或"上下文已被压缩"。`;

/**
 * Build the trailing user message that drives the compaction LLM.
 *
 * When `previousSummary` is provided, the prompt explicitly frames the
 * task as "update the anchor summary" and embeds the previous summary
 * inside `<previous-summary>` tags so the model can recognise the
 * boundary and merge incrementally. Otherwise it falls back to a
 * "create a new anchor summary" instruction.
 */
export function buildCompactionUserPrompt(input?: { previousSummary?: string }): string {
  const previous = input?.previousSummary?.trim();
  const anchorBlock = previous
    ? [
        '请使用以上对话历史更新下面的锚点摘要。',
        '保留仍然成立的细节、删除已过期的、合并新事实。',
        '<previous-summary>',
        previous,
        '</previous-summary>',
      ].join('\n')
    : '基于以上对话历史创建一份新的锚点摘要。';

  return [anchorBlock, '', COMPACTION_OUTPUT_TEMPLATE].join('\n');
}
