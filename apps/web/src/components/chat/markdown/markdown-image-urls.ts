/**
 * 从 Markdown 源文本中按出现顺序抽取图片 URL 列表。
 *
 * 背景：`react-markdown` 的 `img` 渲染器拿不到「同一段 Markdown 里的兄弟图片」，
 * 要做图集左右切换只能在解析阶段先把整段正文里的图片按出现顺序收集起来，
 * 渲染器再用自己的 `src` 在列表里定位下标（见 `markdown-image.tsx`）。
 *
 * 保守处理策略（只覆盖当前调用点需要的形式，不做完整 CommonMark 解析）：
 *   - 支持 `![alt](url)` 与 `![alt](url "title")`（title 的单引号 / 括号写法一并兼容）；
 *   - `url` 允许用 `<...>` 包裹（可含空格），也允许内部成对括号（如 `img(1).png`）；
 *   - 先剥离 fenced code block 与行内代码，避免把示例代码里的图片语法算进图集；
 *     未闭合的围栏（流式半成品）按「从这里到结尾都是代码」处理；
 *   - **不感知链接嵌套**：`[![alt](img)](href)` 中位于链接内的图片同样按出现顺序被收录。
 *     因此「图集收录」（本文件，按正文顺序收集全部图片 URL）与「可点击入口」
 *     （`markdown-image.tsx` 依据链接上下文决定是否渲染触发器）是两件事：
 *     链接内图片不渲染放大按钮，但其 URL 仍在图集里。
 *
 * 提取失败（未闭合括号、空目标、未闭合的 `<`）时跳过该图片，调用方会退化为
 * 「单图查看器」而不是丢掉可点击能力。
 */

/** 已闭合的代码围栏（``` 与 ~~~ 各自配对）。 */
const CLOSED_FENCE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
/** 剥离已闭合围栏后仍残留的围栏标记：视为未闭合围栏，其后内容整体丢弃。 */
const UNCLOSED_FENCE = /(?:```|~~~)[\s\S]*$/;
/** 行内代码（不跨行）。 */
const INLINE_CODE = /`[^`\n]*`/g;
/** 图片起始标记，匹配到 `](` 为止，destination 由 `readImageDestination` 读取。 */
const IMAGE_OPEN = /!\[[^\]]*\]\(/g;

function stripCode(markdown: string): string {
  return markdown.replace(CLOSED_FENCE, '').replace(UNCLOSED_FENCE, '').replace(INLINE_CODE, '');
}

/**
 * 读取 `![alt](` 之后的图片目标地址。
 *
 * 返回 `null` 表示该图片写法无效（未闭合 / 空目标），调用方应跳过。
 */
function readImageDestination(source: string, start: number): string | null {
  let cursor = start;
  while (cursor < source.length && /\s/u.test(source[cursor] ?? '')) {
    cursor += 1;
  }

  if (source[cursor] === '<') {
    const end = source.indexOf('>', cursor + 1);
    if (end === -1) return null;
    const wrapped = source.slice(cursor + 1, end).trim();
    return wrapped === '' ? null : wrapped;
  }

  const startIndex = cursor;
  let depth = 0;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === '\\') {
      // 转义序列整体跳过，避免把 `\(` 当成真正的括号层级。
      cursor += 2;
      continue;
    }
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      if (depth === 0) break;
      depth -= 1;
    } else if (char !== undefined && /\s/u.test(char)) {
      break;
    }
    cursor += 1;
  }

  if (cursor === startIndex) return null;
  // 未闭合括号（读到了文本结尾还没遇到 `)` 或空白分隔）：该图片语法不可渲染，跳过。
  if (cursor >= source.length) return null;
  return source.slice(startIndex, cursor);
}

/**
 * 按出现顺序返回 Markdown 正文里的图片 URL。
 *
 * 对「图片是否位于链接内」无感知：链接内图片的 URL 同样计入返回列表（见文件头注释）。
 *
 * 同一 URL 出现多次时会返回多个条目（每张图各占一个位次），调用方按
 * `indexOf` 定位到第一个同址图片 —— 视觉上等价，仅进度指示可能指向首个。
 */
export function extractMarkdownImageUrls(markdown: string): string[] {
  const source = stripCode(markdown);
  const urls: string[] = [];

  for (const match of source.matchAll(IMAGE_OPEN)) {
    const openIndex = (match.index ?? 0) + match[0].length;
    const url = readImageDestination(source, openIndex);
    if (url !== null) urls.push(url);
  }

  return urls;
}
