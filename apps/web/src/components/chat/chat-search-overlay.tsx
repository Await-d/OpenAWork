import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage } from '../session-conversation/runtime/support.js';
import {
  type ChatSearchMatch,
  clampSearchIndex,
  findChatMessageMatches,
} from './chat-search-support.js';

/**
 * Duration of the flash-border highlight applied to the message card the
 * user navigates to. Long enough to register as a transient cue, short
 * enough that "next match" feels responsive when held down.
 */
const FLASH_DURATION_MS = 1500;

/**
 * Minimum query length before we run the (cheap, but not free) search pass
 * over potentially hundreds of messages. One-character substrings produce
 * mostly noise and would mark every message every keystroke.
 */
const MIN_QUERY_LENGTH = 2;

interface UseChatSearchOptions {
  messages: ChatMessage[];
  scrollRegionRef: React.RefObject<HTMLDivElement | null>;
}

interface UseChatSearchReturn {
  isOpen: boolean;
  query: string;
  matches: ChatSearchMatch[];
  currentIndex: number;
  roleFilter: 'user' | 'assistant' | null;
  open: (initialQuery?: string) => void;
  close: () => void;
  setQuery: (next: string) => void;
  setRoleFilter: (filter: 'user' | 'assistant' | null) => void;
  gotoNext: () => void;
  gotoPrev: () => void;
  gotoMatch: (matchIndex: number) => void;
}

/**
 * In-page search controller for the chat transcript. Runs a plain-text
 * substring scan over the message array, navigates by `messageIndex`,
 * and triggers a brief flash highlight on the target card so the user
 * can spot the result even when the surrounding markdown contains the
 * query in many places.
 *
 * The hook deliberately does not perform DOM-level mark wrapping — that
 * would conflict with virtualization (matches in unmounted groups would
 * vanish) and with the markdown / rehype pipeline (mutating rendered
 * children mid-flight). Card-level navigation gives 90% of the value
 * for ~10% of the complexity.
 */
export function useChatSearch({
  messages,
  scrollRegionRef,
}: UseChatSearchOptions): UseChatSearchReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQueryState] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [roleFilter, setRoleFilter] = useState<'user' | 'assistant' | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  const lastFlashedRef = useRef<HTMLElement | null>(null);

  const matches = useMemo<ChatSearchMatch[]>(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) return [];
    return findChatMessageMatches(messages, trimmed, roleFilter);
  }, [messages, query, roleFilter]);

  // Whenever the matches list changes (new query, new messages), keep the
  // cursor inside the valid range. We derive a primitive signature so the
  // effect doesn't fire on every parent re-render — only when the actual
  // match identity / count shifts. Biome's exhaustive-deps rule treats
  // the signature as redundant because `setCurrentIndex` is stable, but
  // dropping the dependency would turn this into a one-shot mount effect
  // and the cursor would never reset on re-search.
  const matchesSignature = `${matches.length}:${matches[0]?.messageId ?? ''}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: signature is the trigger
  useEffect(() => {
    setCurrentIndex(0);
  }, [matchesSignature]);

  const clearFlash = useCallback(() => {
    if (flashTimerRef.current != null) {
      window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
    }
    if (lastFlashedRef.current) {
      lastFlashedRef.current.removeAttribute('data-search-flash');
      lastFlashedRef.current = null;
    }
  }, []);

  useEffect(() => clearFlash, [clearFlash]);

  const focusMessage = useCallback(
    (messageId: string) => {
      const region = scrollRegionRef.current;
      if (!region) return;
      const target = region.querySelector<HTMLElement>(
        `[data-message-id="${cssAttrEscape(messageId)}"]`,
      );
      if (!target) return;

      // Smooth-scroll into view. `block: 'center'` so the matched card
      // is comfortably visible rather than glued to a viewport edge.
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Apply the transient flash. Clear any previous flash first so
      // rapid prev/next navigation doesn't leave stale highlights on
      // earlier cards.
      clearFlash();
      target.setAttribute('data-search-flash', 'true');
      lastFlashedRef.current = target;
      flashTimerRef.current = window.setTimeout(() => {
        target.removeAttribute('data-search-flash');
        if (lastFlashedRef.current === target) {
          lastFlashedRef.current = null;
        }
        flashTimerRef.current = null;
      }, FLASH_DURATION_MS);
    },
    [clearFlash, scrollRegionRef],
  );

  const open = useCallback((initialQuery?: string) => {
    setIsOpen(true);
    if (initialQuery !== undefined) {
      setQueryState(initialQuery);
    }
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    clearFlash();
  }, [clearFlash]);

  const setQuery = useCallback((next: string) => {
    setQueryState(next);
  }, []);

  const gotoMatch = useCallback(
    (matchIndex: number) => {
      if (matches.length === 0) return;
      const wrapped = clampSearchIndex(matchIndex, matches.length);
      setCurrentIndex(wrapped);
      const target = matches[wrapped];
      if (target) focusMessage(target.messageId);
    },
    [matches, focusMessage],
  );

  const gotoNext = useCallback(() => {
    gotoMatch(currentIndex + 1);
  }, [currentIndex, gotoMatch]);

  const gotoPrev = useCallback(() => {
    gotoMatch(currentIndex - 1);
  }, [currentIndex, gotoMatch]);

  return {
    isOpen,
    query,
    matches,
    currentIndex,
    roleFilter,
    open,
    close,
    setQuery,
    setRoleFilter,
    gotoNext,
    gotoPrev,
    gotoMatch,
  };
}

interface ChatSearchOverlayProps {
  controller: UseChatSearchReturn;
}

export function ChatSearchOverlay({ controller }: ChatSearchOverlayProps) {
  const {
    isOpen,
    query,
    matches,
    currentIndex,
    roleFilter,
    close,
    setQuery,
    setRoleFilter,
    gotoNext,
    gotoPrev,
  } = controller;
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    // Defer focus to the next frame so the input is mounted and any
    // previously focused element (textarea / button) has released focus.
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  if (!isOpen) return null;

  const trimmed = query.trim();
  const hasQuery = trimmed.length >= MIN_QUERY_LENGTH;
  const matchCount = matches.length;
  const counterLabel = !hasQuery
    ? '输入至少 2 个字符'
    : matchCount === 0
      ? '无匹配'
      : `${currentIndex + 1} / ${matchCount}`;

  return (
    <div
      className="chat-search-overlay"
      role="dialog"
      aria-label="在对话中查找"
      data-testid="chat-search-overlay"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="chat-search-overlay-icon"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
      <input
        ref={inputRef}
        type="text"
        value={query}
        placeholder="在对话中查找"
        className="chat-search-overlay-input"
        data-testid="chat-search-overlay-input"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
            return;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            if (event.shiftKey) {
              gotoPrev();
            } else {
              gotoNext();
            }
          }
        }}
      />

      {/* Role filter pills */}
      <div className="chat-search-overlay-filters" style={{ display: 'flex', gap: 2 }}>
        <button
          type="button"
          className="chat-search-overlay-filter-btn"
          data-active={roleFilter === null ? 'true' : undefined}
          onClick={() => setRoleFilter(null)}
          title="搜索全部消息"
          style={{
            height: 18,
            padding: '0 5px',
            borderRadius: 9,
            border:
              roleFilter === null ? '1px solid var(--accent)' : '1px solid var(--border-subtle)',
            background:
              roleFilter === null
                ? 'color-mix(in oklch, var(--accent) 12%, transparent)'
                : 'transparent',
            color: roleFilter === null ? 'var(--accent)' : 'var(--text-3)',
            fontSize: 9,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          全部
        </button>
        <button
          type="button"
          className="chat-search-overlay-filter-btn"
          data-active={roleFilter === 'user' ? 'true' : undefined}
          onClick={() => setRoleFilter(roleFilter === 'user' ? null : 'user')}
          title="仅搜索用户消息"
          style={{
            height: 18,
            padding: '0 5px',
            borderRadius: 9,
            border:
              roleFilter === 'user' ? '1px solid var(--accent)' : '1px solid var(--border-subtle)',
            background:
              roleFilter === 'user'
                ? 'color-mix(in oklch, var(--accent) 12%, transparent)'
                : 'transparent',
            color: roleFilter === 'user' ? 'var(--accent)' : 'var(--text-3)',
            fontSize: 9,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          👤
        </button>
        <button
          type="button"
          className="chat-search-overlay-filter-btn"
          data-active={roleFilter === 'assistant' ? 'true' : undefined}
          onClick={() => setRoleFilter(roleFilter === 'assistant' ? null : 'assistant')}
          title="仅搜索助手消息"
          style={{
            height: 18,
            padding: '0 5px',
            borderRadius: 9,
            border:
              roleFilter === 'assistant'
                ? '1px solid var(--accent)'
                : '1px solid var(--border-subtle)',
            background:
              roleFilter === 'assistant'
                ? 'color-mix(in oklch, var(--accent) 12%, transparent)'
                : 'transparent',
            color: roleFilter === 'assistant' ? 'var(--accent)' : 'var(--text-3)',
            fontSize: 9,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          🤖
        </button>
      </div>

      <span
        className="chat-search-overlay-counter"
        data-testid="chat-search-overlay-counter"
        data-empty={hasQuery && matchCount === 0 ? 'true' : undefined}
      >
        {counterLabel}
      </span>
      <div className="chat-search-overlay-actions">
        <button
          type="button"
          className="chat-search-overlay-button"
          onClick={gotoPrev}
          disabled={matchCount === 0}
          title="上一个匹配 (Shift+Enter)"
          aria-label="上一个匹配"
        >
          ↑
        </button>
        <button
          type="button"
          className="chat-search-overlay-button"
          onClick={gotoNext}
          disabled={matchCount === 0}
          title="下一个匹配 (Enter)"
          aria-label="下一个匹配"
        >
          ↓
        </button>
        <button
          type="button"
          className="chat-search-overlay-button is-close"
          onClick={close}
          title="关闭 (Esc)"
          aria-label="关闭查找"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

/**
 * Escape characters that have meaning inside a CSS attribute selector. Message
 * ids are normally URL-safe but the chat layer mints ids from a few sources
 * and we don't want a future change to break the lookup silently.
 */
function cssAttrEscape(value: string): string {
  return value.replace(/(["\\])/g, '\\$1');
}
