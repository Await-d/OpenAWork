import type { ChatMessage } from '../conversation-runtime/messages/support.js';

export interface ChatSearchMatch {
  /** Stable id of the matching `ChatMessage`. */
  messageId: string;
  /** Index of the message in the source array (helps with stable cursoring). */
  messageIndex: number;
  /** A short text snippet centred on the first occurrence within this message. */
  snippet: string;
  /** Number of times the query appeared in this message's searchable text. */
  occurrences: number;
  /** Role of the matching message for filter display. */
  role: 'user' | 'assistant';
}

const SNIPPET_RADIUS = 32;
const SNIPPET_PREFIX = '…';
const SNIPPET_SUFFIX = '…';

/**
 * Build the plain-text body that the search runs against for a given message.
 *
 * Assistant messages frequently carry structured payloads (tool traces, JSON
 * envelopes, generative-ui blobs). For search purposes we want the surface
 * text the user actually reads — not the wire JSON — so we fall back through
 * a few well-known shapes. The order matches `getCopyableMessageText` in
 * `use-chat-message-actions.ts`, but we deliberately keep this module
 * dependency-free so it stays trivial to unit test.
 */
export function extractSearchableText(message: ChatMessage): string {
  const raw = message.content ?? '';
  if (!raw) return '';

  // Cheap path: most user messages and many assistant messages are plain
  // markdown / text; only attempt a JSON parse when the payload looks like
  // it could be one. `JSON.parse` of a typical 4 KB message block is fast
  // but adds up across hundreds of messages on every keystroke.
  const trimmed = raw.trimStart();
  if (trimmed.length === 0 || (trimmed[0] !== '{' && trimmed[0] !== '[')) {
    return raw;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Assistant trace envelope: { kind: 'assistant_trace', text, reasoningBlocks? }
    if (typeof parsed['text'] === 'string') {
      const reasoningBlocks = Array.isArray(parsed['reasoningBlocks'])
        ? (parsed['reasoningBlocks'] as unknown[])
            .filter((entry): entry is string => typeof entry === 'string')
            .join('\n')
        : '';
      const toolCalls = Array.isArray(parsed['toolCalls'])
        ? (parsed['toolCalls'] as Array<Record<string, unknown>>)
            .map((toolCall) =>
              typeof toolCall['toolName'] === 'string' ? toolCall['toolName'] : '',
            )
            .filter((name) => name.length > 0)
            .join(' ')
        : '';
      return [reasoningBlocks, parsed['text'], toolCalls]
        .filter((segment) => typeof segment === 'string' && segment.length > 0)
        .join('\n');
    }
    // Status / compaction payloads: { type, payload: { title, message|summary } }
    const payload = parsed['payload'];
    if (payload && typeof payload === 'object') {
      const fields = ['title', 'message', 'summary'] as const;
      const surface = fields
        .map((key) => (payload as Record<string, unknown>)[key])
        .filter((value): value is string => typeof value === 'string')
        .join('\n');
      if (surface.length > 0) return surface;
    }
    // Fall through: searching the raw JSON is still better than nothing
    // (e.g. tool name embedded in an unexpected envelope).
    return raw;
  } catch {
    return raw;
  }
}

/**
 * Find every message whose searchable text contains `query` (case-insensitive,
 * substring match). Empty / whitespace queries return an empty list. Results
 * preserve the input message order so "previous" / "next" navigation maps
 * cleanly to scroll-up / scroll-down.
 *
 * Optional `roleFilter` restricts results to messages of a specific role.
 */
export function findChatMessageMatches(
  messages: ChatMessage[],
  query: string,
  roleFilter?: 'user' | 'assistant' | null,
): ChatSearchMatch[] {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length === 0) return [];

  const lowerQuery = normalizedQuery.toLowerCase();
  const matches: ChatSearchMatch[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) continue;
    if (roleFilter && message.role !== roleFilter) continue;
    const haystack = extractSearchableText(message);
    if (haystack.length === 0) continue;
    const lowerHaystack = haystack.toLowerCase();
    const firstHit = lowerHaystack.indexOf(lowerQuery);
    if (firstHit === -1) continue;

    // Count total occurrences without rebuilding lowercased copies.
    let occurrences = 0;
    let cursor = 0;
    while (cursor !== -1) {
      cursor = lowerHaystack.indexOf(lowerQuery, cursor);
      if (cursor === -1) break;
      occurrences += 1;
      cursor += lowerQuery.length;
    }

    matches.push({
      messageId: message.id,
      messageIndex: index,
      snippet: buildSnippet(haystack, firstHit, normalizedQuery.length),
      occurrences,
      role: message.role,
    });
  }

  return matches;
}

function buildSnippet(haystack: string, hitOffset: number, hitLength: number): string {
  const start = Math.max(0, hitOffset - SNIPPET_RADIUS);
  const end = Math.min(haystack.length, hitOffset + hitLength + SNIPPET_RADIUS);
  const slice = haystack.slice(start, end).replace(/\s+/g, ' ').trim();
  const prefix = start > 0 ? SNIPPET_PREFIX : '';
  const suffix = end < haystack.length ? SNIPPET_SUFFIX : '';
  return `${prefix}${slice}${suffix}`;
}

/**
 * Wrap the provided index into the matches range. Returns 0 when the list is
 * empty so callers can rely on `currentIndex` being meaningful only via
 * `matches.length > 0` checks.
 */
export function clampSearchIndex(index: number, matchCount: number): number {
  if (matchCount <= 0) return 0;
  const wrapped = ((index % matchCount) + matchCount) % matchCount;
  return wrapped;
}
