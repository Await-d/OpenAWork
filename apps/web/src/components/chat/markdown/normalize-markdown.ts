import { normalizeMathMarkdown } from './normalize-math-markdown.js';
import { transformInlineReasoningTags } from './transform-inline-reasoning-tags.js';
import { transformSubagentResultBlocks } from '@openAwork/shared';

/**
 * A `<br>` that sits alone on its own line is parsed as *block-level* HTML
 * instead of inline HTML, so it never reaches the inline components that
 * `renderTextWithPaths` walks — it would keep rendering as a literal
 * `<br>` in the message body. Such a tag is only asking for a blank line,
 * which markdown already provides, so drop the tag and let the surrounding
 * blank lines handle the spacing.
 */
const STANDALONE_BREAK_LINE = /^[ \t]*<br\s*\/?>[ \t]*\r?$/gimu;

function stripStandaloneBreakLines(markdown: string): string {
  return markdown.replace(STANDALONE_BREAK_LINE, '');
}

/**
 * 助手消息正文的统一归一化入口：流式与静态两条渲染管线都必须先经过这里，
 * 否则同一段内容在「流式尾部」与「定稿后」会得到不同的 DOM。
 *
 * 顺序说明：子代理 `<results>` 结构化块改写必须在最前执行——它把
 * `<files>/<answer>/…` 子标签换成段落级加粗标题，后续管线（数学归一化、
 * 思考块改写）看到的是稳定文本，避免在残留标签上误伤。
 */
export function normalizeAssistantMarkdown(content: string): string {
  const transformed = transformSubagentResultBlocks(content, 'markdown');
  return stripStandaloneBreakLines(
    normalizeMathMarkdown(transformInlineReasoningTags(transformed)),
  );
}
