/**
 * 非图片附件在消息正文里的引用行解析 / 剥离。
 *
 * 上游写入方是 `attachment-upload.ts`：
 * - `buildUploadedAttachmentSummary` 把每个附件的行拼成 `[附件]\n- <fileName> (artifact:<artifactId>) …`
 * - `appendAttachmentSummary` 再把该段**追加到正文末尾**（`\n\n${summary}`）
 *
 * 因此真实形态是「用户正文 + 空行 + `[附件]` 段」。解析必须**以 `[附件]` 段为界**：
 * 用户正文里完全可能出现形如 `- foo.pdf (artifact:bar)` 的文本（例如粘贴日志），
 * 全文扫描会把它们误判成附件。
 *
 * 两个函数都是纯函数，且任何解析失败都降级为「返回原文」，绝不丢内容。
 */

export interface AttachmentReference {
  readonly fileName: string;
  readonly artifactId: string;
}

/** 附件段标题行（允许行首缩进）。 */
const ATTACHMENT_SECTION_HEADER = '[附件]';

/**
 * artifactId 的真实形态由上游决定：网关上传路由用 `randomUUID()` 生成
 * （`services/agent-gateway/src/routes/artifacts.ts:330`），字符集为小写十六进制
 * 加连字符。这里用等价字符类约束，避免把段内其它 `(artifact:...)` 误认。
 */
const ATTACHMENT_REFERENCE_LINE_PATTERN =
  /^[ \t]*-[ \t]+(.+?)[ \t]*\(artifact:([0-9a-fA-F-]+)\)[ \t]*$/;

interface AttachmentSection {
  /** `[附件]` 标题行之前的全部行（用户正文）。 */
  readonly bodyLines: readonly string[];
  /** `[附件]` 标题行之后到文本末尾的全部行。 */
  readonly sectionLines: readonly string[];
}

function isSectionHeader(line: string): boolean {
  return line.trim() === ATTACHMENT_SECTION_HEADER;
}

/**
 * 定位 `[附件]` 段。
 *
 * 取**第一个**标题行（上游只会追加一次；取第一个可保证「段」是后缀语义稳定）。
 * 找不到则返回 `null`，调用方据此降级为返回原文。
 */
function locateAttachmentSection(text: string): AttachmentSection | null {
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex(isSectionHeader);
  if (headerIndex < 0) {
    return null;
  }

  return {
    bodyLines: lines.slice(0, headerIndex),
    sectionLines: lines.slice(headerIndex + 1),
  };
}

function matchReferenceLine(line: string): AttachmentReference | null {
  const match = ATTACHMENT_REFERENCE_LINE_PATTERN.exec(line);
  if (!match) {
    return null;
  }

  const fileName = match[1]?.trim();
  const artifactId = match[2];
  if (!fileName || !artifactId) {
    return null;
  }

  return { fileName, artifactId };
}

/**
 * 从消息正文的 `[附件]` 段中解析出所有附件引用。
 *
 * - 只认 `[附件]` 段内的行；段外正文即使形如引用也不会被解析
 * - 保序、不去重（同一条消息可引用同一文件两次，或两个同名不同 id 的文件）
 * - 找不到 `[附件]` 段或段内无合法引用行 → 返回空数组，绝不抛错
 */
export function parseAttachmentReferences(text: string): readonly AttachmentReference[] {
  if (!text) {
    return [];
  }

  const section = locateAttachmentSection(text);
  if (!section) {
    return [];
  }

  const references: AttachmentReference[] = [];
  for (const line of section.sectionLines) {
    const reference = matchReferenceLine(line);
    if (reference) {
      references.push(reference);
    }
  }

  return references;
}

/**
 * 移除整个 `[附件]` 段，其余内容（用户正文）原样保留。
 *
 * - 移除范围是「`[附件]` 行到文本末尾」，含其中的引用行与「内容摘录」块
 *   —— 只删引用行会留下孤零零的标题和无归属的摘录，比不剥离更糟
 * - 剥离后只在末尾规整多余空行，**不得挤压正文内部的空行**
 * - 降级：找不到 `[附件]` 段，或段内没有任何合法引用行 → 返回原文
 */
export function stripAttachmentReferences(text: string): string {
  if (!text) {
    return text;
  }

  const section = locateAttachmentSection(text);
  if (!section) {
    return text;
  }

  const hasReference = section.sectionLines.some((line) => matchReferenceLine(line) !== null);
  if (!hasReference) {
    return text;
  }

  // 用户正文尾部由 `appendAttachmentSummary` 添加的空行一并裁掉。
  let end = section.bodyLines.length;
  while (end > 0 && section.bodyLines[end - 1]?.trim() === '') {
    end -= 1;
  }

  return section.bodyLines.slice(0, end).join('\n');
}
