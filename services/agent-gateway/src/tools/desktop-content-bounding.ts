/**
 * desktop_automation `content` 的**源头裁剪**(写历史之前收口)。
 *
 * `content` 返回整页 HTML,是最容易把会话上下文顶起来的单条结果(动辄几十 KB)。
 * 这里在工具执行边界就把它收口:
 *   - 未超限:返回 `{"content": <html>}`,与既有形状完全一致;
 *   - 超限:只返回 UTF-8 安全的**头部预览**,并把**完整 HTML** 落盘到
 *     `(sessionId, toolCallId)` 对应的 spill 文件,模型可用 `read_tool_output`
 *     按 toolCallId 分页取回全文(`read_tool_output` 会优先读 spill 文件)。
 *
 * 为什么放在「源头」而不是「每轮渲染」:
 *   - 只在**写时**截断一次,历史随后只增不改 → 不会逐轮改写前缀,不打断 prompt-cache;
 *   - 会话里保存的是小预览而非整页 HTML,存储与上下文同时变小。
 */

import { DEFAULT_TOOL_CONTEXT_POLICY } from '../compaction/tool-context-policy.js';
import { spillToolOutput } from './tool-output-spill.js';
import { buildReadToolOutputHint } from './tool-output-tools.js';

/**
 * `content` 预览字节上限。
 *
 * 取 `read_tool_output` 的单页预算(`maxReadPageBytes`)同量级,续读体验一致:
 * 模型拿到预览后,用 `read_tool_output` 逐页取回全文。
 */
export const DESKTOP_CONTENT_PREVIEW_MAX_BYTES = DEFAULT_TOOL_CONTEXT_POLICY.maxReadPageBytes;

/** UTF-8 安全头部截断(不截出半个多字节字符)。 */
function utf8SafeHead(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0 && (buf[end]! & 0b1100_0000) === 0b1000_0000) {
    end -= 1;
  }
  return buf.subarray(0, end).toString('utf8');
}

export interface DesktopContentBoundInput {
  readonly html: string;
  readonly sessionId: string;
  readonly toolCallId: string;
}

/**
 * 生成 `content` 动作的模型可见输出(JSON 字符串)。
 *
 * - 未超限:`{"content": <html>}`(形状不变,调用方无需分支);
 * - 超限:`{"content": <预览>, "truncated": true, "previewBytes", "totalBytes", "hint"}`,
 *   并把完整 HTML 落盘供 `read_tool_output` 取回;落盘失败时附 `spillUnavailable`
 *   标记(此时模型只能看到预览,提示其改用更精确的 `evaluate`/`find` 取局部)。
 */
export function boundDesktopContentOutput(input: DesktopContentBoundInput): string {
  const totalBytes = Buffer.byteLength(input.html, 'utf8');
  if (totalBytes <= DESKTOP_CONTENT_PREVIEW_MAX_BYTES) {
    return JSON.stringify({ content: input.html });
  }

  const preview = utf8SafeHead(input.html, DESKTOP_CONTENT_PREVIEW_MAX_BYTES);
  const spilledPath = spillToolOutput({
    sessionId: input.sessionId,
    toolCallId: input.toolCallId,
    content: input.html,
  });

  return JSON.stringify({
    content: preview,
    truncated: true,
    previewBytes: Buffer.byteLength(preview, 'utf8'),
    totalBytes,
    ...(spilledPath === null ? { spillUnavailable: true } : {}),
    hint:
      spilledPath === null
        ? '整页 HTML 过大且完整内容未能落盘;请改用更精确的 evaluate/find 只取所需片段。'
        : buildReadToolOutputHint(input.toolCallId),
  });
}
