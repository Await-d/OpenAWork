import { isFullHtmlDocument } from './markdown-html-document.js';

export interface StreamingMarkdownSegments {
  activeTail: string;
  stableBlocks: string[];
}

const FENCE_START = /^(```|~~~)/u;
// 缩进只认 ASCII 空格/Tab：markdown 的缩进语义本就不含 CJK 全角空格（U+3000）与
// NBSP，而 `\s` 会命中它们，把中文段首缩进误判为续行，导致 tail 永不 flush、
// 每帧整段重解析。
const LIST_ITEM_START = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]/u;
const INDENTED_CONTINUATION = /^[ \t]/u;
const LINK_REFERENCE_DEFINITION = /^[ \t]{0,3}\[[^\]]+\]:[ \t]*/u;
const RAW_HTML_BLOCK_START =
  /^[ \t]{0,3}(?:<\/?(?:script|pre|style|textarea)\b|<!--|<\?|<![A-Za-z])/u;
const MATH_BLOCK_FENCE = /^\$\$[ \t]*$/u;

// 链接引用定义、HTML block type 1–5（`<pre>`/`<script>`/`<!--` 等，空白行不终止）、
// `$$` 数学块的作用域都是整篇文档，无法在空行处安全切开：拆开后引用解析会失败，
// 或空白行被误当块边界。一旦出现就整篇不切分，用单次解析保证与静态渲染一致。
// 围栏代码块内的同名文本不算。
function hasDocumentScopedConstruct(lines: string[]): boolean {
  let inFence = false;
  for (const line of lines) {
    if (FENCE_START.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    if (
      LINK_REFERENCE_DEFINITION.test(line) ||
      RAW_HTML_BLOCK_START.test(line) ||
      MATH_BLOCK_FENCE.test(line)
    ) {
      return true;
    }
  }
  return false;
}

export function splitStreamingMarkdownIntoSegments(content: string): StreamingMarkdownSegments {
  const normalized = content.replace(/\r\n/g, '\n');
  if (normalized.length === 0) {
    return { activeTail: '', stableBlocks: [] };
  }

  const lines = normalized.split('\n');
  if (isFullHtmlDocument(normalized) || hasDocumentScopedConstruct(lines)) {
    return { activeTail: normalized, stableBlocks: [] };
  }

  const stableBlocks: string[] = [];
  let blockLines: string[] = [];

  const flushStableBlock = () => {
    const normalizedLines = [...blockLines];
    while (
      normalizedLines.length > 0 &&
      normalizedLines[normalizedLines.length - 1]?.trim() === ''
    ) {
      normalizedLines.pop();
    }
    const nextBlock = normalizedLines.join('\n');
    if (nextBlock.length > 0) {
      stableBlocks.push(nextBlock);
    }
    blockLines = [];
  };

  const nextNonBlankLine = (fromIndex: number): string | undefined => {
    for (let index = fromIndex; index < lines.length; index += 1) {
      const line = lines[index];
      if (line !== undefined && line.trim() !== '') {
        return line;
      }
    }
    return undefined;
  };

  // 空行是「粗粒度」的块边界：只有解析上真正安全的空行才允许切分。列表项之间
  // 的空行（loose list）与任意缩进续行都必须留在同一段，否则 `<ul>` 或缩进内容
  // 会因为被拆成两段而改变结构。缩进按 ASCII 空格/Tab 判断，因为 `- ` 的续行
  // 缩进是 2 空格、`1. ` 是 3 空格。
  const isSafeFlushBoundary = (lineIndex: number): boolean => {
    const next = nextNonBlankLine(lineIndex + 1);
    if (next === undefined) {
      return true;
    }
    return !LIST_ITEM_START.test(next) && !INDENTED_CONTINUATION.test(next);
  };

  let inFence = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) {
      continue;
    }

    blockLines.push(line);
    const trimmed = line.trim();

    if (FENCE_START.test(trimmed)) {
      inFence = !inFence;
      if (!inFence) {
        flushStableBlock();
      }
      continue;
    }

    if (inFence || trimmed.length > 0) {
      continue;
    }

    if (isSafeFlushBoundary(index)) {
      flushStableBlock();
    }
  }

  return {
    activeTail: blockLines.join('\n'),
    stableBlocks,
  };
}
