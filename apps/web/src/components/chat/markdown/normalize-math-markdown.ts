const MATH_SIGNAL = /(?:\\[a-zA-Z]+|[=<>^_])/u;
const PAREN_MATH_SIGNAL = /(?:\\[a-zA-Z]+|[=<>^_])/u;
const FENCE_START = /^\s{0,3}(`{3,}|~{3,})/u;
const TRAILING_MATH_PUNCTUATION = /([.。；;！!，,])$/u;
const LATEX_COMMAND = /\\[a-zA-Z]+/u;
const DIGIT = /\d/u;
// Markdown 链接目标里的 `_` / `=` 会命中数学信号，但它显然不是公式。
const URL_LIKE = /^[a-zA-Z][\w+.-]*:\/\//u;
/**
 * CJK 汉字、假名、谚文以及中文 / 全角标点。公式里出现这些字符几乎总是
 * 自然语言被误判成了公式（模型常见写法如 `（计费月起，较上月 > 100）`
 * 会被括号规则包成 `$…$`），交给 KaTeX 只会换来一串
 * `unicodeTextInMathMode` 告警和错位的排版。
 */
const CJK_TEXT = /[⺀-鿿豈-﫿︰-﹏＀-￯]/u;
const DISPLAY_MATH_SEGMENT = /\$\$([\s\S]+?)\$\$/gu;
const INLINE_MATH_SEGMENT = /(?<!\\)\$([^$\n]+?)\$(?!\$)/gu;
const DOLLAR = /\$/gu;

export function normalizeMathMarkdown(markdown: string): string {
  if (!markdown || !MATH_SIGNAL.test(markdown)) {
    return markdown;
  }

  const lines = markdown.split(/(\r?\n)/u);
  let fenceMarker: string | undefined;
  let prose = '';
  let output = '';

  const flushProse = (): void => {
    if (prose) {
      output += normalizeMathText(prose);
      prose = '';
    }
  };

  for (const line of lines) {
    const content = line.replace(/\r?\n$/u, '');
    const fence = FENCE_START.exec(content);

    if (fenceMarker === undefined && fence?.[1] !== undefined) {
      flushProse();
      fenceMarker = fence[1][0];
      output += line;
      continue;
    }

    if (fenceMarker !== undefined) {
      output += line;
      if (fence?.[1]?.startsWith(fenceMarker)) {
        fenceMarker = undefined;
      }
      continue;
    }

    prose += line;
  }

  flushProse();
  return output;
}

function normalizeMathText(markdown: string): string {
  const protectedMath: string[] = [];
  const protect = (value: string): string => {
    const index = protectedMath.push(value) - 1;
    return `\u0000MATH_${index}\u0000`;
  };

  let normalized = demoteCjkMath(markdown)
    .replace(
      /(^|\n)[ \t]*\\\[([\s\S]*?)\\\](?=\n|$)/gu,
      (_match, prefix: string, body: string) => `${prefix}${protect(toDisplayMath(body))}`,
    )
    .replace(/\\\[([\s\S]*?)\\\]/gu, (_match, body: string) => protect(toDisplayMath(body)))
    .replace(/\\\(([^\n]+?)\\\)/gu, (_match, body: string) => protect(`$${body.trim()}$`))
    .replace(/\(([^()\n]*?)\)/gu, (match, body: string) => {
      if (!PAREN_MATH_SIGNAL.test(body) || !looksLikeMath(body)) {
        return match;
      }
      return protect(`$${body.trim()}$`);
    });

  normalized = normalized.replace(/(^|\n)[ \t]*\$\$[\s\S]*?\$\$(?=\n|$)/gu, (match) =>
    protect(match),
  );

  normalized = normalized.replace(
    /(^|\n)([ \t]*)\[[ \t]*\n([\s\S]*?)\n[ \t]*\](?=\n|$)/gu,
    (match, prefix: string, _indentation: string, body: string) => {
      if (!MATH_SIGNAL.test(body) || CJK_TEXT.test(body)) {
        return match;
      }
      return `${prefix}${protect(toDisplayMath(body))}`;
    },
  );

  normalized = normalized.replace(
    /(^|\n)([ \t]*)(\\(?:boxed|frac|sqrt|sum|int|lim)\s*\{[^\n]+\})([.,。；;！!]?)?(?=\n|$)/gu,
    (_match, prefix: string, indentation: string, expression: string, punctuation = '') =>
      `${prefix}${indentation}${protect(toDisplayMath(expression))}${punctuation ? `\n${punctuation}` : ''}`,
  );

  return normalized.replace(/\u0000MATH_(\d+)\u0000/gu, (_match, index: string) => {
    return protectedMath[Number(index)] ?? _match;
  });
}

/**
 * 把已经写成 `$…$` / `$$…$$` 但内容其实是中文正文的片段降级回普通文本。
 *
 * 模型（尤其是带推理过程的输出）经常把整句中文包进数学分隔符，例如
 * `$计费月起（2026-01 及之后），较上月 > 100 元$`。KaTeX 在数学模式下
 * 遇到中文字符会逐字打印 `unicodeTextInMathMode` 并渲染成错位的斜体，
 * 一次长回复能刷出上百行告警。这里只转义分隔符、保留原文内容。
 *
 * 含 LaTeX 命令的片段不降级——那是 `\text{合计}` 这类真正的公式，只是
 * 需要 KaTeX 的文本模式来承载中文。
 */
function demoteCjkMath(markdown: string): string {
  return markdown
    .replace(DISPLAY_MATH_SEGMENT, (match, body: string) => demoteSegment(match, body))
    .replace(INLINE_MATH_SEGMENT, (match, body: string) => demoteSegment(match, body));
}

function demoteSegment(match: string, body: string): string {
  if (!CJK_TEXT.test(body) || LATEX_COMMAND.test(body)) {
    return match;
  }

  return match.replace(DOLLAR, () => '\\$');
}

/**
 * 括号内容是否值得当公式处理。除了数学信号，还要求是「数字或 LaTeX 命令
 * 参与其中」，且不含中文与 URL——否则 `（计费月起，较上月 > 100）` 这类
 * 中文注释会被整段塞进数学模式。
 */
function looksLikeMath(body: string): boolean {
  if (CJK_TEXT.test(body) || URL_LIKE.test(body)) {
    return false;
  }

  return DIGIT.test(body) || LATEX_COMMAND.test(body);
}

function toDisplayMath(body: string): string {
  const trimmed = body.trim();
  const formula = trimmed.replace(TRAILING_MATH_PUNCTUATION, '');
  return `$$\n${formula}\n$$`;
}
