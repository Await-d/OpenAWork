/**
 * 「tool 输出被 recovery 瘦身截断」的标记格式。
 *
 * 服务端 `slimMessagesForRecovery`（services/agent-gateway/src/routes/session-route-helpers.ts）
 * 会在被裁剪的字符串末尾追加这个标记；前端需要把它识别出来、渲染成「已截断」徽标
 * 而不是当成正文。格式定义放在 shared 里，避免两侧各写一份而漂移。
 */

/** 标记正文（不含前导换行）。 */
export const TOOL_OUTPUT_TRUNCATION_MARKER_PREFIX = '…[truncated, ';
/** 标记结尾。 */
export const TOOL_OUTPUT_TRUNCATION_MARKER_SUFFIX = ' chars omitted]';

/** 生成标记（含前导换行，与截断点原文以换行分隔）。 */
export function formatToolOutputTruncationMarker(omittedChars: number): string {
  return `\n${TOOL_OUTPUT_TRUNCATION_MARKER_PREFIX}${omittedChars}${TOOL_OUTPUT_TRUNCATION_MARKER_SUFFIX}`;
}

/**
 * 匹配标记。前导 `\n` 可有可无：标记可能被序列化进 JSON 字符串再反序列化，
 * 也可能出现在字符串开头（例如整个输出就是一个被截断的叶子）。
 */
const TRUNCATION_MARKER_PATTERN = new RegExp(
  `\\n?${TOOL_OUTPUT_TRUNCATION_MARKER_PREFIX.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(\\d+)${TOOL_OUTPUT_TRUNCATION_MARKER_SUFFIX.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`,
  'gu',
);

/**
 * 找出文本中所有截断标记，返回被省略的字符总数。
 * 无标记时返回 `null`（用于「是否显示徽标」的判断，避免与 `0` 混淆）。
 */
export function findToolOutputTruncation(text: string): { omittedChars: number } | null {
  if (!text.includes(TOOL_OUTPUT_TRUNCATION_MARKER_PREFIX)) {
    return null;
  }
  let omittedChars = 0;
  let matched = false;
  for (const match of text.matchAll(TRUNCATION_MARKER_PATTERN)) {
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed)) {
      omittedChars += parsed;
      matched = true;
    }
  }
  return matched ? { omittedChars } : null;
}

/** 剥离文本中的截断标记，返回可读正文。 */
export function stripToolOutputTruncation(text: string): string {
  if (!text.includes(TOOL_OUTPUT_TRUNCATION_MARKER_PREFIX)) {
    return text;
  }
  return text.replace(TRUNCATION_MARKER_PATTERN, '');
}

/** 递归收集任意输出里所有字符串，供深层扫描截断标记使用。 */
function collectOutputStrings(value: unknown, sink: string[], depth = 0): void {
  // 深度护栏：tool 输出理论上是有限树，但异常数据不应让扫描退化成栈溢出。
  if (depth > 12) {
    return;
  }
  if (typeof value === 'string') {
    sink.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectOutputStrings(item, sink, depth + 1);
    }
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectOutputStrings(item, sink, depth + 1);
    }
  }
}

/**
 * 在任意形状的 tool 输出里查找截断标记（含对象 / 数组内嵌套字符串）。
 *
 * 输出既可能是裸字符串（bash 的 stdout），也可能是 `{ stdout, stderr, ... }`
 * 这类对象，标记可能出现在任一叶子上，因此需要递归。
 */
export function findToolOutputTruncationDeep(output: unknown): { omittedChars: number } | null {
  const strings: string[] = [];
  collectOutputStrings(output, strings);
  let omittedChars = 0;
  let matched = false;
  for (const text of strings) {
    const found = findToolOutputTruncation(text);
    if (found) {
      omittedChars += found.omittedChars;
      matched = true;
    }
  }
  return matched ? { omittedChars } : null;
}

/** 递归剥离。`changed` 用于判断是否需要重建父容器（避免为无标记的树造新对象）。 */
function stripDeep(value: unknown, depth: number): { value: unknown; changed: boolean } {
  if (typeof value === 'string') {
    const stripped = stripToolOutputTruncation(value);
    return { changed: stripped !== value, value: stripped };
  }
  if (depth > 12) {
    return { changed: false, value };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const result = stripDeep(item, depth + 1);
      changed ||= result.changed;
      return result.value;
    });
    return { changed, value: changed ? next : value };
  }
  if (value && typeof value === 'object') {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const result = stripDeep(item, depth + 1);
      changed ||= result.changed;
      next[key] = result.value;
    }
    return { changed, value: changed ? next : value };
  }
  return { changed: false, value };
}

/**
 * 剥离任意形状输出里的截断标记，供 UI 渲染干净正文。
 *
 * 无标记时返回 `null`（调用方沿用原对象引用，不触发额外渲染）；有标记时返回重建后的
 * 结构与省略字符数，由调用方决定如何呈现徽标。
 */
export function stripToolOutputTruncationDeep(
  output: unknown,
): { omittedChars: number; value: unknown } | null {
  const found = findToolOutputTruncationDeep(output);
  if (!found) {
    return null;
  }
  const stripped = stripDeep(output, 0);
  return { omittedChars: found.omittedChars, value: stripped.value };
}
