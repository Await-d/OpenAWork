import { useState } from 'react';
import { JsonPreview } from './json-preview.js';
import { ParamValue } from './parameter-list-preview.js';
import { LazyPreviewDetails, LazyPreviewCopy, PreviewMore } from './bounded-preview.js';

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

function itemTitle(value: unknown, index: number): string {
  const record = asRecord(value);
  if (!record) return `#${index + 1}`;
  for (const key of TITLE_KEYS) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.slice(0, 120).trim().length > 0) {
      return candidate.slice(0, 120).trim();
    }
    if (typeof candidate === 'number') return String(candidate);
  }
  return `#${index + 1}`;
}

export function ArrayOutputPreview({ data }: { data: unknown[] }) {
  const [visibleCount, setVisibleCount] = useState(MAX_ROWS);
  if (data.length === 0) {
    return <div className="param-list-empty">（空数组）</div>;
  }

  const hiddenCount = data.length - visibleCount;
  const shown = data.slice(0, visibleCount);
  const loadMore = hiddenCount > 0 && (
    <PreviewMore onClick={() => setVisibleCount((count) => count + MAX_ROWS)}>
      加载更多项目（还有 {hiddenCount} 项）
    </PreviewMore>
  );
  if (shown.every(isPrimitive)) {
    return (
      <ul className="array-output">
        {shown.map((item, index) => (
          <li className="array-output-item" key={index}>
            <ParamValue value={item} />
          </li>
        ))}
        <li className="array-output-more">
          {loadMore}
          <LazyPreviewCopy data={data} />
        </li>
      </ul>
    );
  }

  return (
    <div className="array-output-objects">
      {shown.map((item, index) => (
        <LazyPreviewDetails
          className="array-output-obj"
          key={index}
          summary={itemTitle(item, index)}
        >
          <JsonPreview data={item} maxLines={14} />
        </LazyPreviewDetails>
      ))}
      <div className="array-output-more">
        {loadMore}
        <LazyPreviewCopy data={data} />
      </div>
    </div>
  );
}
