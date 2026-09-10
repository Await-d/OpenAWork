const MATH_SIGNAL = /(?:\\[a-zA-Z]+|[=<>^_])/u;
const PAREN_MATH_SIGNAL = /(?:\\[a-zA-Z]+|[=<>^_])/u;
const FENCE_START = /^\s{0,3}(`{3,}|~{3,})/u;
const TRAILING_MATH_PUNCTUATION = /([.。；;！!，,])$/u;

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

  let normalized = markdown
    .replace(
      /(^|\n)[ \t]*\\\[([\s\S]*?)\\\](?=\n|$)/gu,
      (_match, prefix: string, body: string) => `${prefix}${protect(toDisplayMath(body))}`,
    )
    .replace(/\\\[([\s\S]*?)\\\]/gu, (_match, body: string) => protect(toDisplayMath(body)))
    .replace(/\\\(([^\n]+?)\\\)/gu, (_match, body: string) => protect(`$${body.trim()}$`))
    .replace(/\(([^()\n]*?)\)/gu, (match, body: string) => {
      if (!PAREN_MATH_SIGNAL.test(body)) {
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
      if (!MATH_SIGNAL.test(body)) {
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

function toDisplayMath(body: string): string {
  const trimmed = body.trim();
  const formula = trimmed.replace(TRAILING_MATH_PUNCTUATION, '');
  return `$$\n${formula}\n$$`;
}
