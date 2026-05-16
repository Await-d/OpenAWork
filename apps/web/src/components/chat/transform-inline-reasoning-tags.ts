/**
 * Some assistant providers (Anthropic Haiku/Sonnet variants, certain
 * agent prompts that ask the model to "think out loud") emit reasoning
 * markup as inline XML-ish tags directly in the message body — for
 * example:
 *
 *   <analysis> **字面请求**: ... </analysis>
 *   I'll now look at the repo.
 *
 * ReactMarkdown silently drops unknown HTML tags but keeps their text
 * content, which means the prose inside still renders (bold, lists,
 * etc.) while the literal `<analysis>` and `</analysis>` strings leak
 * through as plain text. The result looks broken: a stray opening tag
 * at the top of the message, content rendered "naked", and a stray
 * closing tag at the bottom.
 *
 * Rather than try to register a custom HTML tag with rehype, we
 * normalise the markup at the source: rewrite recognised reasoning
 * tags into a fenced ```thinking``` code block. The existing
 * `ThinkingCodeBlock` renderer in `markdown-message-content.tsx`
 * already turns those into a collapsible "Thinking" pane, which is
 * exactly the UX we want for inline analysis blocks.
 *
 * The transform is:
 *   - case-insensitive on tag names
 *   - fence-aware (does not touch tags that appear inside an existing
 *     ``` or ~~~ code block)
 *   - tolerant of streaming input (an unclosed `<analysis>` becomes
 *     the start of a fence; the closing fence appears once the
 *     `</analysis>` arrives)
 *   - idempotent (no recognised tags remain after one pass, so a
 *     second application is a no-op).
 */

// Canonical names of reasoning-style tags we recognise. Variants
// that differ only in word-separator (e.g. `inner_monologue` vs
// `inner-monologue`) do not need separate entries — the regex
// builder below treats `_` and `-` interchangeably so both forms
// match the same canonical name.
//
// Sources informing the list:
//   - Anthropic Claude prompt conventions: thinking / scratchpad /
//     plan / inner_monologue / reflection / analysis.
//   - DeepSeek-R1 and a few open reasoning models: `think`
//     (singular, no `-ing`) and `reasoning_process`.
//   - ReAct and Reflexion-style agent prompts: thought / rationale /
//     deliberation / thought_process.
//
// Tags representing user-visible content (e.g. `observation`,
// `output`, `final_answer`) are intentionally NOT included — folding
// them into a collapsed thinking pane would hide information the
// reader should see.
const REASONING_TAG_NAMES = [
  'analysis',
  'thinking',
  'think',
  'reasoning',
  'reasoning_process',
  'thought',
  'thoughts',
  'thought_process',
  'reflection',
  'scratchpad',
  'scratch_pad',
  'scratch',
  'inner_monologue',
  'monologue',
  'plan',
  'planning',
  'rationale',
  'deliberation',
] as const;

// Treat `_` and `-` interchangeably inside multi-word names so we
// match both `<inner_monologue>` and `<inner-monologue>` without
// having to enumerate every separator variant.
const REASONING_TAG_GROUP = `(?:${REASONING_TAG_NAMES.map((name) =>
  name.replace(/_/g, '[_-]'),
).join('|')})`;

// Probe pattern — used as a fast bail-out so the common case (no
// reasoning tags anywhere in the message) skips the heavier
// fence-aware splitting.
const PROBE_RE = new RegExp(`<\\s*\\/?\\s*${REASONING_TAG_GROUP}\\b`, 'i');

// Open / close tag matchers. We allow surrounding whitespace inside
// the angle brackets but no attributes — the assistant emits bare
// tags in practice, and accepting attributes would risk swallowing
// legitimate content like `<analysis-component>` should that ever
// appear in user-provided markdown.
const OPEN_TAG_RE = new RegExp(`<\\s*${REASONING_TAG_GROUP}\\s*>`, 'gi');
const CLOSE_TAG_RE = new RegExp(`<\\s*\\/\\s*${REASONING_TAG_GROUP}\\s*>`, 'gi');

// Splits content on existing code fences so we can skip them. Even
// indices in the result are non-fence segments (where we apply the
// transform); odd indices are the fenced segments themselves
// (preserved verbatim).
const FENCE_SPLIT_RE = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g;

// We use four backticks when emitting the synthetic fence so that
// reasoning content containing ordinary triple-backtick code samples
// still parses as a single block.
const FENCE_DELIM = '````';
const FENCE_OPEN = `\n\n${FENCE_DELIM}thinking\n`;
const FENCE_CLOSE = `\n${FENCE_DELIM}\n\n`;

/**
 * Rewrite recognised inline reasoning tags into a `thinking` fenced
 * code block so the existing markdown renderer turns them into a
 * collapsible reasoning panel.
 */
export function transformInlineReasoningTags(content: string): string {
  if (!content) return content;
  if (!PROBE_RE.test(content)) return content;

  const parts = content.split(FENCE_SPLIT_RE);
  return parts
    .map((part, index) => {
      // Odd-indexed parts are existing code fences — preserve them
      // verbatim so we don't break user code samples that happen to
      // contain `<analysis>` etc.
      if (index % 2 === 1) return part;
      return transformOutsideFences(part);
    })
    .join('');
}

function transformOutsideFences(text: string): string {
  if (!text) return text;
  if (!PROBE_RE.test(text)) return text;

  // Replace open tags first, then close tags. Order doesn't matter
  // for correctness — we're working on a fence-free segment, so
  // mixing them is fine — but doing opens first keeps the resulting
  // string easy to reason about while debugging.
  let result = text.replace(OPEN_TAG_RE, FENCE_OPEN);
  result = result.replace(CLOSE_TAG_RE, FENCE_CLOSE);
  return result;
}
