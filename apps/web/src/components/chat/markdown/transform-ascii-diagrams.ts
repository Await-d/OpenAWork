/**
 * Some assistant replies include ASCII / Unicode box-drawing diagrams
 * (deployment topology, layered architecture, directory trees, …) directly
 * in the prose, e.g.
 *
 *   ┌─────────────┐    ┌─────────────┐
 *   │  Web (Vue)  │ →  │  API (.NET) │
 *   └─────────────┘    └─────────────┘
 *
 * If the upstream `text` does not wrap the block in a fenced code block,
 * markdown rendering destroys the alignment in two ways:
 *   1. HTML collapses runs of spaces, so the carefully aligned columns
 *      break under the variable-width default font.
 *   2. remark-gfm sees dense `|` runs and tries to parse them as a GFM
 *      table; without a header separator (`|---|`) the lines are
 *      shredded into mismatched cells and rebroken.
 *
 * The fix is to detect those blocks and wrap them in a `text` fenced
 * code block before markdown parsing runs. The existing renderer turns
 * fenced code into a monospace block with whitespace preserved, which
 * is exactly what these diagrams need.
 *
 * Detection heuristic — a "diagram line" contains at least one character
 * from the Unicode box-drawing or block-elements ranges:
 *   - U+2500..U+257F  Box Drawing
 *   - U+2580..U+259F  Block Elements
 *
 * A run of ≥2 diagram lines (allowing single blank lines inside the
 * run for visual spacing) is wrapped in a `\`\`\`\`text` fence. We use
 * four backticks so a diagram that itself includes triple-backtick
 * samples still parses as one block.
 *
 * Fence-aware: walks the input line-by-line and skips anything inside an
 * existing fenced code block (including 4-tick blocks that may contain
 * nested 3-tick blocks, which a non-greedy regex split would mismatch).
 *
 * Idempotent: a second pass sees the wrapped content as already inside
 * a fence and leaves it alone.
 */

// Box Drawing (U+2500..U+257F) + Block Elements (U+2580..U+259F).
// Picked as the signal because they only appear in art-style content;
// regular Chinese / English prose never contains them.
const DIAGRAM_CHAR_RE = /[\u2500-\u259F]/;

// CommonMark fence: up to 3 leading spaces, then ≥3 backticks or tildes.
// Captures the indent and the delimiter run so callers can compare
// open / close lengths and characters.
const FENCE_LINE_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;

// Fence delimiter for the synthetic wrapper. Four backticks so any
// `\`\`\`` inside the diagram body still parses as part of the block.
const FENCE_DELIM = '````';
const FENCE_LANG = 'text';

interface FenceMatch {
  char: '`' | '~';
  length: number;
}

function matchFenceLine(line: string): FenceMatch | null {
  const m = FENCE_LINE_RE.exec(line);
  if (!m) return null;
  const delim = m[2]!;
  return { char: delim[0] as '`' | '~', length: delim.length };
}

function isDiagramLine(line: string): boolean {
  return DIAGRAM_CHAR_RE.test(line);
}

export function transformAsciiDiagrams(content: string): string {
  if (!content) return content;
  // Fast bail-out: nothing to do if the content has zero box-drawing
  // characters at all.
  if (!DIAGRAM_CHAR_RE.test(content)) return content;

  const lines = content.split('\n');
  const out: string[] = [];

  // Tracks the active fence delimiter (e.g. '```', '~~~~', '`````').
  // While set, every line is forwarded verbatim until we see a closing
  // line whose delimiter matches the open char and is at least as long.
  let openFence: FenceMatch | null = null;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';

    // Inside an existing fenced block — pass through verbatim and
    // close the fence when we see a matching closer.
    if (openFence !== null) {
      out.push(line);
      const close = matchFenceLine(line);
      if (close && close.char === openFence.char && close.length >= openFence.length) {
        openFence = null;
      }
      i += 1;
      continue;
    }

    // Encountered a fence opener — record it and pass through.
    const open = matchFenceLine(line);
    if (open) {
      openFence = open;
      out.push(line);
      i += 1;
      continue;
    }

    // Normal text line.
    if (!isDiagramLine(line)) {
      out.push(line);
      i += 1;
      continue;
    }

    // Greedily extend a diagram run. A run is allowed to contain a
    // single blank line as a visual separator between two adjacent
    // diagrams (e.g. a deployment topology with two stacked tiers).
    // We never cross a fence boundary.
    let end = i + 1;
    while (end < lines.length) {
      const candidate = lines[end] ?? '';
      if (matchFenceLine(candidate)) break;
      if (isDiagramLine(candidate)) {
        end += 1;
        continue;
      }
      if (
        candidate.trim() === '' &&
        end + 1 < lines.length &&
        !matchFenceLine(lines[end + 1] ?? '') &&
        isDiagramLine(lines[end + 1] ?? '')
      ) {
        end += 2;
        continue;
      }
      break;
    }

    const runLength = end - i;
    if (runLength < 2) {
      // A lone diagram-character line (e.g. a single "─────" divider
      // or a stray "→ next" inside prose) is not enough signal —
      // wrapping it in a code block is more disruptive than helpful.
      out.push(line);
      i += 1;
      continue;
    }

    // Make sure the synthetic fence sits on its own paragraph so the
    // surrounding markdown isn't pulled into the code block.
    if (out.length > 0 && (out[out.length - 1] ?? '').trim() !== '') {
      out.push('');
    }
    out.push(`${FENCE_DELIM}${FENCE_LANG}`);
    for (let k = i; k < end; k += 1) {
      out.push(lines[k] ?? '');
    }
    out.push(FENCE_DELIM);
    // Trailing blank line so the next paragraph isn't glued to the
    // closing fence (only when there's actually more content after).
    if (end < lines.length && (lines[end] ?? '').trim() !== '') {
      out.push('');
    }

    i = end;
  }

  return out.join('\n');
}
