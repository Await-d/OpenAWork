/**
 * 子代理「结构化结果块」解析器（三端共用的 SSOT）。
 *
 * explore / scout / web-researcher 等只读子代理在系统提示中约定了
 * `<results>` 结构化结果块，子标签有两种已知形态：
 *   - explore: `<files>` + `<answer>` + `<next_steps>`
 *   - scout / web-researcher: `<findings>` + `<answer>` + `<uncertainties>`
 *
 * 客户端拿到 `SubagentNotice.text`（网关已剥掉 `<subagent>` 包裹的纯正文）
 * 后，用本解析器把它拆成可格式化展示的分节；没有结构化块的普通正文
 * 会被兜底为 `raw` 节，渲染侧据此决定是否走「格式化卡片」。
 *
 * 放在 `shared` 而非 `shared-ui`：与 `parseSubagentNotice` 同层，
 * Web / 桌面 / 移动端共享同一份语义。
 */

/** 结构化结果块的分节类型。 */
export type SubagentResultSectionKind =
  'files' | 'findings' | 'answer' | 'next_steps' | 'uncertainties' | 'other' | 'raw';

export interface SubagentResultItem {
  /** 条目正文（如文件路径、发现结论）。 */
  text: string;
  /** 「—」之后的解释 / 证据（可能缺失）。 */
  detail?: string;
}

export interface SubagentResultSection {
  kind: SubagentResultSectionKind;
  /** 该节标题（渲染侧展示用；`raw` 节无标题）。 */
  title?: string;
  /** `files` / `findings` 等列表节的条目。 */
  items?: SubagentResultItem[];
  /** `answer` / `raw` / `other` 等正文节的文本。 */
  body?: string;
}

/** 分节标题：与内置 agent 提示词的子标签一一对应。 */
const SECTION_TITLES: Readonly<Partial<Record<SubagentResultSectionKind, string>>> = {
  files: '相关文件',
  findings: '关键发现',
  answer: '回答',
  next_steps: '后续步骤',
  uncertainties: '待确认',
};

/**
 * 子会话视图里 assistant 消息仍然携带 `<results>` 结构化块（内置 agent 提示词
 * 约定）。通用渲染管线（react-markdown / 移动端纯文本）会把未知标签裸露成
 * 字面文本，这里提供文本级改写：把已知子标签换成分节标题（markdown 模式用
 * `**加粗**` 段落级标题，避免 h1–h3 在聊天流里过大），未知标签原样保留。
 *
 * 与 `transformInlineReasoningTags` 相同的三条纪律：
 * 围栏感知（代码块内的标签不动）、流式容忍（未闭合的开标签也先剥掉，
 * 闭合到达后补出标题）、幂等（改写结果不再匹配探针，二次调用 no-op）。
 */
const RESULT_TAG_NAMES = ['results', 'files', 'findings', 'answer', 'next_steps', 'uncertainties'];
/** 探针：只有正文真带 `<results>` 块时才启动改写，普通消息零成本跳过。 */
const RESULT_PROBE_RE = /<\s*\/?\s*results\b/iu;
// `_` 与 `-` 互换匹配，使 `<next-steps>` 与 `<next_steps>` 都命中。
const RESULT_TAG_GROUP = `(?:${RESULT_TAG_NAMES.map((name) => name.replace(/_/g, '[_-]')).join(
  '|',
)})`;
const RESULT_SECTION_RE = new RegExp(`<\\s*(\\/?)\\s*(${RESULT_TAG_GROUP})\\s*>`, 'giu');

export type SubagentResultTransformMode = 'markdown' | 'plain';

export function transformSubagentResultBlocks(
  content: string,
  mode: SubagentResultTransformMode = 'markdown',
): string {
  if (content.length === 0 || !RESULT_PROBE_RE.test(content)) {
    return content;
  }

  // 拆分现有代码围栏：奇数段原样保留，避免改写用户/模型贴出的示例代码。
  const parts = content.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g);
  return parts
    .map((part, index) => (index % 2 === 1 ? part : transformResultTagsOutsideFence(part, mode)))
    .join('');
}

function transformResultTagsOutsideFence(text: string, mode: SubagentResultTransformMode): string {
  return text.replace(RESULT_SECTION_RE, (_whole, slash: string, tag: string) => {
    const normalizedTag = tag.toLowerCase().replace(/-/g, '_');
    // 关闭标签 / 外层 `<results>`：只剥壳，不留痕。
    if (slash === '/' || normalizedTag === 'results') {
      return '';
    }
    const label = SECTION_TITLES[normalizedTag as keyof typeof SECTION_TITLES] ?? normalizedTag;
    // markdown 模式：加粗段落级标题 + 前后空行，与下方列表/正文自然分节；
    // plain 模式（移动端纯文本）：裸标题行即可，避免泄漏 markdown 装饰符。
    return mode === 'markdown' ? `\n\n**${label}**\n\n` : `\n${label}\n`;
  });
}

/** 列表条目：`- 正文 — 解释`（分隔符兼容 `—` / `–` 全角破折号）。 */
const ITEM_LINE_RE = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/u;
/** 条目内「正文 — 解释」分隔符。 */
const ITEM_DETAIL_RE = /\s+[—–]\s+/u;

/** 探测：正文里是否存在（未被代码围栏包裹的）`<results>` 块。 */
export function hasSubagentResultBlocks(text: string): boolean {
  if (text.length === 0 || !text.includes('<results>')) {
    return false;
  }

  return !isInsideCodeFence(text, text.indexOf('<results>'));
}

function sectionKindFromTag(tag: string): SubagentResultSectionKind {
  switch (tag.toLowerCase()) {
    case 'files':
      return 'files';
    case 'findings':
      return 'findings';
    case 'answer':
      return 'answer';
    case 'next_steps':
      return 'next_steps';
    case 'uncertainties':
      return 'uncertainties';
    default:
      return 'other';
  }
}

function parseItemLine(line: string): SubagentResultItem {
  const match = ITEM_LINE_RE.exec(line);
  const raw = (match?.[1] ?? line).trim();
  if (raw.length === 0) {
    return { text: '' };
  }

  const detailMatch = ITEM_DETAIL_RE.exec(raw);
  if (detailMatch) {
    const detailIndex = detailMatch.index;
    return {
      text: raw.slice(0, detailIndex).trim(),
      detail: raw.slice(detailIndex + detailMatch[0].length).trim(),
    };
  }

  return { text: raw };
}

function sectionFromContent(
  kind: SubagentResultSectionKind,
  content: string,
): SubagentResultSection {
  const lines = content
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  if (
    kind === 'files' ||
    kind === 'findings' ||
    kind === 'next_steps' ||
    kind === 'uncertainties'
  ) {
    // 列表节：识别 `- ` / `1. ` 前缀的条目；无前缀的行并入上一条 detail，
    // 没有上一条时降级为独立条目。
    const items: SubagentResultItem[] = [];
    for (const line of lines) {
      const itemMatch = ITEM_LINE_RE.exec(line);
      if (itemMatch) {
        items.push(parseItemLine(line));
        continue;
      }
      const last = items[items.length - 1];
      if (last) {
        last.detail = last.detail ? `${last.detail} ${line.trim()}` : line.trim();
      } else {
        items.push(parseItemLine(line));
      }
    }
    return {
      kind,
      title: SECTION_TITLES[kind] ?? '',
      items,
    };
  }

  // 正文体节（answer / other）：保留原始换行。
  return {
    kind,
    title: SECTION_TITLES[kind] ?? '',
    body: content.trim(),
  };
}

function parseResultsBlock(blockContent: string): SubagentResultSection[] {
  const sections: SubagentResultSection[] = [];

  const sectionPattern =
    /<\s*(\/?)\s*([A-Za-z][A-Za-z0-9_-]*)\s*>([\s\S]*?)(?=<\s*\/?\s*[A-Za-z][A-Za-z0-9_-]*\s*>|$)/gu;
  let match: RegExpExecArray | null;
  while ((match = sectionPattern.exec(blockContent)) !== null) {
    const isClosing = match[1] === '/';
    const tag = match[2];
    if (!tag || isClosing) {
      continue;
    }
    sections.push(sectionFromContent(sectionKindFromTag(tag), match[3] ?? ''));
    // 手动推进：`$` 空匹配场景下避免死循环
    sectionPattern.lastIndex = match.index + match[0].length;
  }

  return sections;
}

function isInsideCodeFence(text: string, position: number): boolean {
  const fenceRe = /(^|\n)(\s*)(````?|~~~)/g;
  let openFence: { char: string; length: number } | null = null;
  let lastMatch: RegExpExecArray | null = null;
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = fenceRe.exec(text)) !== null) {
    if (fenceMatch.index > position && openFence) {
      // 开围栏在目标之后才出现，且没有更早的配对围栏 → 不在围栏内
      break;
    }
    const marker = fenceMatch[0].includes('~~~') ? '~' : '`';
    const markerLength = (fenceMatch[3] ?? '').length;
    if (openFence && marker === openFence.char && markerLength >= openFence.length) {
      openFence = null;
    } else {
      openFence = { char: marker, length: markerLength };
    }
    lastMatch = fenceMatch;
    fenceRe.lastIndex = fenceMatch.index + fenceMatch[0].length;
  }
  return Boolean(openFence && lastMatch && lastMatch.index < position);
}

/**
 * 把子代理结果正文解析为分节。
 *
 * - 存在 `<results>` 块：拆出块内各子标签（files/findings/answer/…），
 *   块外的前后文本降级为 `raw` 节（通常只有截断提示行等少量内容）。
 * - 不存在：整段正文作为单个 `raw` 节返回，`sections` 恒非空。
 */
export function parseSubagentResultBlocks(text: string): SubagentResultSection[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return [{ kind: 'raw', body: '' }];
  }

  const resultsIndex = trimmed.indexOf('<results>');
  if (resultsIndex < 0 || isInsideCodeFence(trimmed, resultsIndex)) {
    return [{ kind: 'raw', body: trimmed }];
  }

  const before = trimmed.slice(0, resultsIndex).trim();
  const afterTag = trimmed.slice(resultsIndex + '<results>'.length);
  const closeIndex = afterTag.lastIndexOf('</results>');
  const blockContent = closeIndex >= 0 ? afterTag.slice(0, closeIndex) : afterTag;
  const after = closeIndex >= 0 ? afterTag.slice(closeIndex + '</results>'.length).trim() : '';

  const sections = parseResultsBlock(blockContent);
  if (before.length > 0) {
    sections.unshift({ kind: 'raw', body: before });
  }
  if (after.length > 0) {
    sections.push({ kind: 'raw', body: after });
  }
  return sections;
}

/** 是否值得走「格式化卡片」：至少一个结构化子节（非 raw）。 */
export function isStructuredSubagentResult(sections: readonly SubagentResultSection[]): boolean {
  return sections.some((section) => section.kind !== 'raw');
}

/**
 * 正文是否带有**可见**的子代理结果节（结构化分节内有内容：条目或正文）。
 * 消息级折叠用它做豁免判定：带 `<results>` 总结的正文必须完整展示，
 * 不得裁到 60vh 后面后折叠提示。仅统计结构化分节——`<results>` 块前后
 * 的普通文本（raw 节）属于常规正文，不豁免折叠。
 */
export function isSubagentResultSectionVisible(content: string): boolean {
  if (content.length === 0 || !hasSubagentResultBlocks(content)) {
    return false;
  }

  const sections = parseSubagentResultBlocks(content);
  if (
    sections.some(
      (section) =>
        section.kind !== 'raw' &&
        ((section.items?.length ?? 0) > 0 || (section.body?.trim().length ?? 0) > 0),
    )
  ) {
    return true;
  }

  // 纯文本结果块：`<results>` 内没有已知子标签但仍有正文（如只有 answer 文本），
  // 总结内容同样不应被折叠裁掉。
  const innerText = content
    .slice(content.indexOf('<results>') + '<results>'.length, lastIndexOfResultsClose(content))
    .replace(/<\s*\/?\s*(files|findings|answer|next[_-]steps|uncertainties)\s*>/gi, '')
    .trim();
  return innerText.length > 0;
}

function lastIndexOfResultsClose(content: string): number {
  const closeIndex = content.lastIndexOf('</results>');
  // 内部内容截止在 `</results>` 标签**开始**处（不含标签本身）。
  return closeIndex >= 0 ? closeIndex : content.length;
}

/**
 * 从解析结果里挑出主答案（`answer` 节）；没有时回退到第一个含正文的节。
 * 通知行单行展示用它做摘要，避免直接把原始 XML 塞进 hover。
 */
export function pickSubagentResultAnswer(sections: readonly SubagentResultSection[]): string {
  const answer = sections.find((section) => section.kind === 'answer');
  const answerBody = answer?.body?.trim();
  if (answerBody && answerBody.length > 0) {
    return answerBody;
  }

  const fallback = sections.find((section) => (section.body?.trim().length ?? 0) > 0);
  return fallback?.body?.trim() ?? '';
}

/**
 * 把解析结果转成单行摘要（用于 hover / 无障碍标签 / 单行展示）：
 * 取答案首行，去掉 markdown 装饰，超过 `maxLength` 时截断。
 */
export function summarizeSubagentResult(
  sections: readonly SubagentResultSection[],
  maxLength = 120,
): string {
  const answer = pickSubagentResultAnswer(sections)
    .replace(/^[#*\s]+/u, '')
    .split('\n')[0]
    ?.trim();
  if (!answer || answer.length === 0) {
    return '';
  }
  if (answer.length <= maxLength) {
    return answer;
  }
  return `${answer.slice(0, maxLength)}…`;
}
