/**
 * Pure tokenizer used by the chat-markdown renderer to detect file
 * path references inside plain text and split them out so the parent
 * can wrap each match in a clickable link element.
 *
 * Why a regex and not a remark plugin: the markdown AST is already
 * parsed by the time we reach `<p>` / `<li>` / `<td>` rendering, and
 * the text children we receive are plain strings. A remark plugin
 * would have to mirror this same regex at the AST level — for V1 we
 * tokenize at render time, which keeps the plugin pipeline simple.
 *
 * Detection rules:
 *   - At least one `/` separator (rules out arbitrary identifiers like
 *     `Buffer.byteLength`).
 *   - Requires a known file extension (1–5 lowercase chars after a
 *     dot) on the trailing segment so non-file paths like `apps/web`
 *     don't match.
 *   - Optional `:<line>` suffix captured separately.
 *   - Word boundaries on both sides so "foo.ts" inside a longer
 *     identifier doesn't get picked up.
 *   - URLs are already wrapped in `<a>` by react-markdown, so we
 *     don't need to exclude them here — they don't reach our text
 *     nodes as raw strings.
 */

// `\b` doesn't anchor on `/` so we use explicit lookbehind/lookahead
// against `[\w/]` to avoid capturing partial paths.
const PATH_PATTERN =
  /(?<![\w/:])((?:\.{1,2}\/|\/)?(?:[\w@.+-]+\/){1,}[\w@.+-]+\.[a-z]{1,5})(?::(\d+))?(?![\w/])/gi;

/**
 * Bare-filename pattern for use inside backtick-wrapped inline code.
 * Once the user has signalled "this is code-ish" by wrapping it in
 * `…`, even a path-less reference like `create_quotation.py` or
 * `需求分析.md` is overwhelmingly a file name. Outside of inline
 * code we keep the stricter `PATH_PATTERN` (requires at least one
 * slash) to avoid false positives like `Buffer.byteLength`.
 *
 * Differences from PATH_PATTERN:
 *   - At least one CJK or word/dot/dash char before the extension
 *     (no slashes required)
 *   - Allows CJK characters in the file name (matches 中文 file names)
 *   - Same trailing optional `:<line>` suffix
 */
const BARE_FILENAME_PATTERN =
  /(?<![\w/:])([\w@.+\-\u4e00-\u9fff]+\.[a-z]{1,5})(?::(\d+))?(?![\w/])/gi;

export interface PathToken {
  type: 'path';
  path: string;
  line: number | null;
  raw: string;
}

export interface TextToken {
  type: 'text';
  value: string;
}

export type PathTextToken = PathToken | TextToken;

/**
 * Split a string into a sequence of `text` and `path` tokens. The
 * concatenation of token raw values reproduces the input exactly, so
 * downstream rendering can rebuild the text with paths wrapped in
 * clickable elements without losing whitespace or punctuation.
 *
 * @param options.allowBareFilename — when `true`, also match
 *   path-less file references like `create_quotation.py`. Intended
 *   for callers rendering inside inline-code segments where the
 *   author has already signalled "this is a file token".
 */
export function tokenizePathsInText(
  text: string,
  options?: { allowBareFilename?: boolean },
): PathTextToken[] {
  if (text.length === 0) return [];
  const pattern = options?.allowBareFilename ? BARE_FILENAME_PATTERN : PATH_PATTERN;
  const result: PathTextToken[] = [];
  let lastEnd = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (start > lastEnd) {
      result.push({ type: 'text', value: text.slice(lastEnd, start) });
    }
    const path = match[1] ?? match[0];
    const lineRaw = match[2];
    const line = lineRaw !== undefined ? Number.parseInt(lineRaw, 10) : null;
    result.push({
      type: 'path',
      path,
      line: Number.isFinite(line) ? line : null,
      raw: match[0],
    });
    lastEnd = end;
  }
  if (lastEnd < text.length) {
    result.push({ type: 'text', value: text.slice(lastEnd) });
  }
  return result;
}

/**
 * Return true if the text contains at least one detectable path. Used
 * by the markdown renderer to short-circuit children walking when
 * there's nothing to tokenize.
 */
export function textContainsPath(text: string): boolean {
  PATH_PATTERN.lastIndex = 0;
  return PATH_PATTERN.test(text);
}
