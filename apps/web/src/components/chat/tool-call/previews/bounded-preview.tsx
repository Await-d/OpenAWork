import { useState, type ReactNode } from 'react';
import { copyTextToClipboard } from '../../../layout/file-tree/file-tree-actions.js';

export const PREVIEW_PAGE_SIZE = 50;
export const PREVIEW_CHAR_STEP = 20_000;

/** Iteration stops before reading values outside the requested prefix. */
export function previewKeys(value: object, limit: number): { keys: string[]; more: boolean } {
  const keys: string[] = [];
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    if (keys.length === limit) return { keys, more: true };
    keys.push(key);
  }
  return { keys, more: false };
}

/** A bounded JSON prefix, without invoking arbitrary toJSON methods or traversing hidden tails. */
export function boundedJson(value: unknown, limit: number): { text: string; clipped: boolean } {
  if (typeof value === 'string')
    return { text: value.slice(0, limit), clipped: value.length > limit };
  let text = '';
  let clipped = false;
  let nodes = 0;
  const ancestors = new Set<object>();
  function* tokens(item: unknown, depth: number): Generator<string> {
    if (++nodes > limit || depth > 64) {
      clipped = true;
      yield '"[层级过深，请复制完整内容]"';
      return;
    }
    if (typeof item === 'string') {
      yield '"';
      // Each stringify sees only a bounded chunk, even for a multi-megabyte string.
      for (let i = 0; i < item.length;) {
        let end = Math.min(item.length, i + 256);
        const last = item.charCodeAt(end - 1);
        if (end < item.length && last >= 0xd800 && last <= 0xdbff) end++;
        yield JSON.stringify(item.slice(i, end)).slice(1, -1);
        i = end;
      }
      yield '"';
      return;
    }
    if (item === null || typeof item !== 'object') {
      yield JSON.stringify(item) ?? 'null';
      return;
    }
    if (ancestors.has(item)) {
      yield '"[循环引用]"';
      return;
    }
    ancestors.add(item);
    const array = Array.isArray(item);
    yield array ? '[' : '{';
    const record = item as Record<string, unknown>;
    const indent = '  '.repeat(depth + 1);
    let count = 0;
    const keys: Iterable<string | number> = array ? item.keys() : ownKeys(item);
    for (const key of keys) {
      if (text.length >= limit || ++nodes > limit) {
        clipped = true;
        break;
      }
      const child: unknown = array ? item[Number(key)] : record[String(key)];
      if (
        !array &&
        (child === undefined || typeof child === 'function' || typeof child === 'symbol')
      )
        continue;
      yield `${count++ ? ',' : ''}\n${indent}`;
      if (!array) {
        yield* tokens(String(key), depth + 1);
        yield ': ';
      }
      yield* tokens(child, depth + 1);
    }
    if (count) yield `\n${'  '.repeat(depth)}`;
    yield array ? ']' : '}';
    ancestors.delete(item);
  }
  for (const token of tokens(value, 0)) {
    const room = limit - text.length;
    if (token.length > room) {
      text += token.slice(0, room);
      clipped = true;
      break;
    }
    text += token;
  }
  return { text, clipped };
}

function* ownKeys(value: object): Generator<string> {
  for (const key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) yield key;
  }
}

export function LazyPreviewDetails({
  initialOpen = false,
  className,
  summary,
  children,
}: {
  initialOpen?: boolean;
  className: string;
  summary: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <details
      className={`${className} bounded-preview`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{summary}</summary>
      {open && children}
    </details>
  );
}

export function PreviewMore({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="tool-output-toggle bounded-preview-action" onClick={onClick}>
      {children}
    </button>
  );
}

export function LazyPreviewCopy({ data }: { data: unknown }) {
  const [status, setStatus] = useState('复制完整内容');
  async function copy() {
    try {
      const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      await copyTextToClipboard(text ?? String(data));
      setStatus('已复制完整内容');
    } catch (error) {
      console.warn('复制完整工具输出失败', error);
      setStatus('复制失败，点击重试');
    }
  }
  return (
    <button
      type="button"
      className="tool-call-copy-btn bounded-preview-action"
      onClick={() => {
        void copy();
      }}
      aria-live="polite"
    >
      {status}
    </button>
  );
}
