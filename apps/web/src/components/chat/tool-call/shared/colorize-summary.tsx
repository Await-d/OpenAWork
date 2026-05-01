/**
 * Tool-call summary colorizer.
 *
 * The block / inline tool-call cards each render a single-line title
 * (e.g. `grep src/foo.ts · "pattern"`, `task_update t-abc → done`,
 * `$ git status -sb`, `Fetch https://example.com`). Without colour the
 * eye has to parse the whole sentence to find the meaningful bits;
 * OpenCode addresses this by tinting paths / strings / arrows / IDs
 * with distinct hues. We replicate that here as a pure tokenizer plus
 * a thin React wrapper that emits `<span class="tc-tok-<kind>">`.
 *
 * Recognised kinds:
 *   - `path`     /repo/path/file.ts | …/file | foo/bar.tsx
 *   - `cmd`      after `$ ` prefix (entire shell command)
 *   - `string`   "..." or '...'
 *   - `num`      bare digits, hex ids, or short prefixed ids (t-abc)
 *   - `url`      http(s)://...
 *   - `keyword`  → · [lang] $ (arrows, brackets, shell prompt)
 *
 * Anything that doesn't match is emitted as `plain` so the caller can
 * leave it in the default text colour.
 */

import { Fragment, type ReactNode } from 'react';

export type SummaryTokenKind = 'plain' | 'path' | 'cmd' | 'string' | 'num' | 'url' | 'keyword';

export interface SummaryToken {
  kind: SummaryTokenKind;
  text: string;
  /** For path tokens, the lowercase file extension without the leading
   *  dot (e.g. `ts`, `tsx`, `py`). Used by CSS `[data-ext]` to apply
   *  a per-language hue. */
  ext?: string;
}

/**
 * Master regex covering the shapes our title/summary helpers emit.
 *
 * Notes:
 *   - `cmd` is anchored to start-of-string + `$ ` because that's how
 *     `BlockToolCall` formats `bash` / `interactive_bash` titles.
 *   - `version` matches semver-ish tuples (`v1.0.0`, `1.2`, `2026.4`)
 *     before `path` so we don't classify them as a malformed path.
 *   - `path` requires either a slash or a dotted filename **with at
 *     least two letters on each side of the dot** — this avoids the
 *     false positives we used to have on English abbreviations like
 *     `e.g`, `i.e`, or `a.m`.
 *   - `id` matches short `prefix-suffix` ids (e.g. `t-abc`, `sess-xyz`)
 *     and long hex strings (commit shas, ≥7 chars to cover `git`'s
 *     default short-sha length) — both rendered as `num`.
 *   - `bracket` matches `[lang]` style tags (`[ts]`, `[python]`).
 */
const TOKEN_RE =
  /(?<url>https?:\/\/[^\s)"]+)|(?<string>"[^"]*"|'[^']*')|(?<bracket>\[[A-Za-z][\w-]*\])|(?<arrow>→|·)|(?<dollar>^\$(?=\s))|(?<version>\bv?\d+\.\d+(?:\.\d+){0,2}\b)|(?<path>…\/[\w@.+-]+(?:\/[\w@.+-]+)*|(?:\.{1,2}\/|\/)?(?:[\w@.+-]+\/)+[\w@.+-]+|\b[\w@+-]{2,}\.[a-z]{2,5}\b)|(?<id>\b[a-z]{1,4}-[a-z0-9][\w-]*\b)|(?<num>\b[0-9a-f]{7,}\b|\b\d+\b)/g;

/** Extract the lowercase extension of a path-shaped string. */
export function extractFilenameExtension(path: string): string | undefined {
  const last = path.split(/[\\/]/).pop() ?? '';
  const dot = last.lastIndexOf('.');
  if (dot <= 0 || dot === last.length - 1) return undefined;
  const ext = last.slice(dot + 1).toLowerCase();
  // Restrict to short alpha extensions so `1.0.0` / commit shas don't
  // get classified as `[data-ext="0"]`.
  if (!/^[a-z]{1,5}$/.test(ext)) return undefined;
  return ext;
}

/**
 * Pure tokenizer. Accepts a raw summary string and returns an ordered
 * list of tokens covering the entire input — adjacent runs that don't
 * match any grammar fragment are emitted as `plain` tokens so callers
 * can re-assemble the original string verbatim.
 */
export function tokenizeSummary(text: string): SummaryToken[] {
  if (!text) return [];

  // Special-case: leading `$ ` becomes a keyword token plus a single
  // `cmd` token spanning the rest. Doing this here (instead of via
  // regex alternation) keeps `cmd` from clobbering every `$` we'd
  // ever want to render, and avoids tokenizing inside the command.
  if (text.startsWith('$ ')) {
    const rest = text.slice(2);
    const tokens: SummaryToken[] = [
      { kind: 'keyword', text: '$' },
      { kind: 'plain', text: ' ' },
    ];
    if (rest) tokens.push({ kind: 'cmd', text: rest });
    return tokens;
  }

  const tokens: SummaryToken[] = [];
  let cursor = 0;

  for (const m of text.matchAll(TOKEN_RE)) {
    const start = m.index ?? 0;
    if (start > cursor) {
      tokens.push({ kind: 'plain', text: text.slice(cursor, start) });
    }
    const g = m.groups ?? {};
    const matched = m[0];
    if (g.url) {
      tokens.push({ kind: 'url', text: matched });
    } else if (g.string) {
      tokens.push({ kind: 'string', text: matched });
    } else if (g.bracket || g.arrow || g.dollar) {
      tokens.push({ kind: 'keyword', text: matched });
    } else if (g.path) {
      const ext = extractFilenameExtension(matched);
      tokens.push(ext ? { kind: 'path', text: matched, ext } : { kind: 'path', text: matched });
    } else if (g.id || g.num || g.version) {
      // Versions, prefix-ids, hex shas and bare integers all share
      // the `num` (purple) hue so the eye learns "this is an
      // identifier, not prose".
      tokens.push({ kind: 'num', text: matched });
    }
    cursor = start + matched.length;
  }
  if (cursor < text.length) {
    tokens.push({ kind: 'plain', text: text.slice(cursor) });
  }
  return tokens;
}

/**
 * Render `text` with each recognised token wrapped in a coloured span.
 * Returns `null` for empty input so the caller can still mount an
 * empty container element.
 */
export function colorizeSummary(text: string): ReactNode {
  const tokens = tokenizeSummary(text);
  if (tokens.length === 0) return null;
  // Tokens are derived deterministically from `text` and never
  // re-ordered, so the array index is a stable identity for the
  // duration of this render. We use a `kind:index` composite key so
  // React still invalidates correctly if the token grammar at a
  // given position changes between renders.
  return (
    <>
      {tokens.map((tok, i) => {
        const key = `${tok.kind}:${i}`;
        if (tok.kind === 'plain') {
          return <Fragment key={key}>{tok.text}</Fragment>;
        }
        return (
          <span
            key={key}
            className={`tc-tok-${tok.kind}`}
            {...(tok.ext ? { 'data-ext': tok.ext } : {})}
          >
            {tok.text}
          </span>
        );
      })}
    </>
  );
}

/**
 * Map a tool name to a coarse category for the tool-name pill colour.
 * Categories mirror the visual grouping in `tool-call/css/tokens.css`.
 *
 * Returns `undefined` for unknown tools so the caller leaves the pill
 * in the default text-2 colour rather than mis-categorising it.
 */
export function getToolCategory(toolName: string): string | undefined {
  const n = toolName.trim().toLowerCase();
  // Read-only inspection
  if (
    n === 'read' ||
    n === 'list' ||
    n === 'grep' ||
    n === 'glob' ||
    n === 'codesearch' ||
    n === 'ast_grep_search' ||
    n === 'workspace_review_status' ||
    n === 'workspace_review_diff' ||
    n === 'read_tool_output'
  ) {
    return 'read';
  }
  // File-mutating edits
  if (
    n === 'write' ||
    n === 'edit' ||
    n === 'multi_edit' ||
    n === 'apply_patch' ||
    n === 'ast_grep_replace' ||
    n === 'workspace_create_directory' ||
    n === 'workspace_review_revert'
  ) {
    return 'edit';
  }
  // Shell / OS interaction
  if (
    n === 'bash' ||
    n === 'interactive_bash' ||
    n === 'background_output' ||
    n === 'background_cancel' ||
    n === 'desktop_automation' ||
    n === 'look_at'
  ) {
    return 'shell';
  }
  // Reasoning / language-server / skill
  if (
    n.startsWith('lsp_') ||
    n === 'skill' ||
    n === 'skill_mcp' ||
    n === 'question' ||
    n === 'askuserquestion' ||
    n === 'enterplanmode' ||
    n === 'exitplanmode'
  ) {
    return 'think';
  }
  // Network
  if (n === 'webfetch' || n === 'websearch' || n === 'google_search') {
    return 'net';
  }
  // Persistent state (todos / tasks / sessions / mcp)
  if (
    n === 'todowrite' ||
    n === 'todoread' ||
    n === 'subtodowrite' ||
    n === 'subtodoread' ||
    n.startsWith('task_') ||
    n.startsWith('session_') ||
    n.startsWith('mcp_') ||
    n === 'batch'
  ) {
    return 'state';
  }
  return undefined;
}
