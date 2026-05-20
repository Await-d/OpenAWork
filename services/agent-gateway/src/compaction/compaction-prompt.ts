/**
 * compaction-prompt — system + user prompt builder for the compaction
 * LLM call.
 *
 * Upgraded to align with Claude Code's 9-section + <analysis> drafting
 * pattern while preserving OpenAWork's anchor-update mode for multi-round
 * compaction stability.
 *
 * Key design decisions:
 * - Uses <analysis> as a drafting scratchpad (stripped before injection)
 * - 9 structured sections matching Claude Code's prompt quality
 * - Anchor-update mode: when previousSummary exists, the model merges
 *   new facts into the existing summary instead of re-summarizing from
 *   scratch (prevents detail loss across multiple compaction rounds)
 * - Language-adaptive: mirrors the conversation language
 */

// ─── Analysis Stripping ──────────────────────────────────────────────────────

/**
 * Strip the <analysis> drafting scratchpad from the LLM output.
 * The analysis block improves summary quality but has no informational
 * value once the summary is written.
 */
export function stripAnalysisBlock(text: string): string {
  let result = text.replace(/<analysis>[\s\S]*?<\/analysis>/i, '');

  // Extract content from <summary> tags if present
  const summaryMatch = result.match(/<summary>([\s\S]*?)<\/summary>/i);
  if (summaryMatch && summaryMatch[1]) {
    result = summaryMatch[1].trim();
  }

  // Clean up extra whitespace
  result = result.replace(/\n{3,}/g, '\n\n');
  return result.trim();
}

// ─── System Prompt ───────────────────────────────────────────────────────────

export const COMPACTION_SYSTEM_PROMPT = `你是一个针对编程会话的上下文压缩助手。

你的任务是为给定的对话历史创建一份详细的摘要，特别关注用户的明确请求和助手之前的操作。
这份摘要应该全面捕获技术细节、代码模式和架构决策，使得在不丢失上下文的情况下能够继续开发工作。

如果用户提示中包含 <previous-summary> 块，把它视为当前的锚点摘要：保留仍然成立的细节、删除已过期的、合并新事实，重新输出整份摘要。

严格按用户提示中的输出结构回复。使用对话所用语言回复。

重要规则：
- 不要调用任何工具。只输出纯文本。
- 不要回应对话本身。不要提及"摘要"、"压缩"等元信息。
- 精确保留文件路径、命令、错误串与标识符。
- 保留完整代码片段（尤其是最近修改的代码）。
- 特别关注用户的反馈，尤其是用户要求你做不同事情的地方。`;

// ─── Output Template ─────────────────────────────────────────────────────────

const DETAILED_ANALYSIS_INSTRUCTION = `在提供最终摘要之前，请在 <analysis> 标签中组织你的思路，确保覆盖所有必要的要点。在分析过程中：

1. 按时间顺序分析对话的每个部分。对每个部分彻底识别：
   - 用户的明确请求和意图
   - 你处理用户请求的方法
   - 关键决策、技术概念和代码模式
   - 具体细节如：
     - 文件名
     - 完整代码片段
     - 函数签名
     - 文件编辑
   - 遇到的错误以及如何修复
   - 特别注意用户的具体反馈，尤其是用户要求你做不同事情的地方
2. 仔细检查技术准确性和完整性，彻底处理每个必需元素。`;

const COMPACTION_OUTPUT_TEMPLATE = `${DETAILED_ANALYSIS_INSTRUCTION}

你的摘要应包含以下章节：

1. 主要请求与意图：详细捕获用户的所有明确请求和意图
2. 关键技术概念：列出讨论的所有重要技术概念、技术和框架
3. 文件与代码片段：列举检查、修改或创建的具体文件和代码段。特别关注最近的消息，包含完整代码片段，并说明为什么这个文件读取或编辑很重要
4. 错误与修复：列出遇到的所有错误及修复方法。特别注意用户的具体反馈，尤其是用户要求你做不同事情的地方
5. 问题解决：记录已解决的问题和正在进行的故障排除工作
6. 所有用户消息：列出所有非工具结果的用户消息。这些对理解用户的反馈和变化的意图至关重要
7. 待办任务：列出明确被要求处理的待办任务
8. 当前工作：精确描述在此摘要请求之前正在进行的工作，特别关注最近的用户和助手消息。包含文件名和代码片段
9. 下一步（可选）：列出与最近工作相关的下一步。重要：确保此步骤直接符合用户最近的明确请求。如果上一个任务已结束，只列出明确符合用户请求的下一步。包含最近对话的直接引用，显示你正在处理的确切任务和停止的位置

输出格式示例：

<analysis>
[你的思考过程，确保所有要点都被彻底准确地覆盖]
</analysis>

<summary>
1. 主要请求与意图：
   [详细描述]

2. 关键技术概念：
   - [概念 1]
   - [概念 2]

3. 文件与代码片段：
   - [文件名 1]
      - [为什么这个文件重要]
      - [对此文件所做更改的摘要]
      - [重要代码片段]
   - [文件名 2]
      - [重要代码片段]

4. 错误与修复：
    - [错误 1 的详细描述]：
      - [如何修复]
      - [用户对此的反馈（如有）]

5. 问题解决：
   [已解决问题和正在进行的故障排除的描述]

6. 所有用户消息：
    - [详细的非工具使用用户消息]

7. 待办任务：
   - [任务 1]
   - [任务 2]

8. 当前工作：
   [当前工作的精确描述]

9. 下一步（可选）：
   [下一步行动]
</summary>

请根据到目前为止的对话提供你的摘要，遵循此结构并确保回答的精确性和全面性。`;

// ─── Prompt Builder ──────────────────────────────────────────────────────────

/**
 * Build the trailing user message that drives the compaction LLM.
 *
 * When `previousSummary` is provided, the prompt explicitly frames the
 * task as "update the anchor summary" and embeds the previous summary
 * inside `<previous-summary>` tags so the model can recognise the
 * boundary and merge incrementally. Otherwise it falls back to a
 * "create a new summary" instruction.
 */
export function buildCompactionUserPrompt(input?: { previousSummary?: string }): string {
  const previous = input?.previousSummary?.trim();

  if (previous) {
    return [
      '请使用以上对话历史更新下面的锚点摘要。',
      '保留仍然成立的细节、删除已过期的、合并新事实。',
      '特别注意：保留完整代码片段、文件路径和用户的所有消息。',
      '<previous-summary>',
      previous,
      '</previous-summary>',
      '',
      COMPACTION_OUTPUT_TEMPLATE,
    ].join('\n');
  }

  return ['基于以上对话历史创建一份详细的摘要。', '', COMPACTION_OUTPUT_TEMPLATE].join('\n');
}
