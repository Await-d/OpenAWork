import { JsonPreview } from './json-preview.js';
import { useIsInsideExpandedToolCard } from '../shared/tool-card-expansion.js';

/**
 * Generic renderer for tool outputs that are arrays. A JSON dump of `[{"…"},
 * …]` is hard to scan, so primitives become a plain list and objects get a
 * one-line title (from a well-known key) plus a drill-down.
 */
const MAX_ROWS = 50;

const TITLE_KEYS = [
  'name',
  'title',
  'symbol',
  'path',
  'file',
  'filePath',
  'message',
  'command',
  'url',
  'uri',
  'id',
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function isPrimitive(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function primitiveText(value: unknown): string {
  if (value === null) return 'null';
  return String(value);
}

function itemTitle(value: unknown, index: number): string {
  const record = asRecord(value);
  if (!record) return `#${index + 1}`;
  for (const key of TITLE_KEYS) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
    if (typeof candidate === 'number') return String(candidate);
  }
  return `#${index + 1}`;
}

export function ArrayOutputPreview({ data }: { data: unknown[] }) {
  const isInsideExpandedCard = useIsInsideExpandedToolCard();
  if (data.length === 0) {
    return <div className="param-list-empty">（空数组）</div>;
  }

  const visibleCount = isInsideExpandedCard ? data.length : MAX_ROWS;
  const hiddenCount = data.length - visibleCount;

  if (data.every(isPrimitive)) {
    const shown = data.slice(0, visibleCount);
    return (
      <ul className="array-output">
        {shown.map((item, index) => (
          <li className="array-output-item" key={`${index}:${primitiveText(item)}`}>
            {primitiveText(item)}
          </li>
        ))}
        {hiddenCount > 0 && <li className="array-output-more">还有 {hiddenCount} 项…</li>}
      </ul>
    );
  }

  const shown = data.slice(0, visibleCount);
  return (
    <div className="array-output-objects">
      {shown.map((item, index) => (
        <details className="array-output-obj" key={index} open={isInsideExpandedCard || undefined}>
          <summary title={itemTitle(item, index)}>{itemTitle(item, index)}</summary>
          <JsonPreview data={item} maxLines={14} />
        </details>
      ))}
      {hiddenCount > 0 && <div className="array-output-more">还有 {hiddenCount} 项…</div>}
    </div>
  );
}
