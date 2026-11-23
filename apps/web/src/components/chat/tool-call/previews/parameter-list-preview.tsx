import { useState, type ReactElement } from 'react';
import {
  LazyPreviewDetails,
  PreviewMore,
  previewKeys,
  PREVIEW_PAGE_SIZE,
} from './bounded-preview.js';
import { JsonPreview } from './json-preview.js';
import { useIsInsideExpandedToolCard } from '../shared/tool-card-expansion.js';

/* ── ParameterListPreview (universal input panel) ── */

/**
 * 优化后的参数列表预览，提升可读性：
 * - 长字符串允许换行而不是截断
 * - 对象和数组默认展开第一层
 * - 增加字段间的视觉间隔
 */

/** Max characters before a string value is collapsed into a `<details>`. */
const INLINE_STRING_LIMIT = 120;
/** Max characters for the primary inline preview text inside that details. */
const INLINE_PREVIEW_LIMIT = 80;

function flattenWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Render a single parameter value inline. The shape returned is always a
 * `<span>`-compatible inline element (or a `<details>` which still behaves
 * inline-block for layout) so it can sit on the same row as its key without
 * forcing a line break.
 *
 * Domain-aware splits:
 *   - null / undefined  → muted "null" / "undefined"
 *   - bool / number     → typed span (so true/false/null/numbers stand out)
 *   - short string      → as-is
 *   - long string       → flattened preview + `<details>` with full text
 *   - small primitive[] → "[a, b, c]" inline
 *   - other arrays      → "[N 项]" with details drill-down
 *   - object            → "对象 · N 键" with details drill-down
 */
export function ParamValue({ value }: { value: unknown }): ReactElement {
  const isInsideExpandedCard = useIsInsideExpandedToolCard();
  if (value === null) {
    return <span className="param-list-null">null</span>;
  }
  if (value === undefined) {
    return <span className="param-list-null">undefined</span>;
  }
  if (typeof value === 'boolean') {
    return (
      <span className="param-list-bool" data-bool={value ? 'true' : 'false'}>
        {value ? 'true' : 'false'}
      </span>
    );
  }
  if (typeof value === 'number') {
    return <span className="param-list-num">{value}</span>;
  }
  if (typeof value === 'string') {
    const isMultiLine = value.slice(0, INLINE_STRING_LIMIT).includes('\n');
    const isLong = value.length > INLINE_STRING_LIMIT;
    if (isLong || isMultiLine) {
      const flat = flattenWhitespace(value.slice(0, INLINE_STRING_LIMIT));
      const preview =
        flat.length > INLINE_PREVIEW_LIMIT ? `${flat.slice(0, INLINE_PREVIEW_LIMIT - 1)}…` : flat;
      return (
        <LazyPreviewDetails
          className="param-list-nested"
          initialOpen={isInsideExpandedCard}
          summary={<span className="param-list-str">{preview}</span>}
        >
          <JsonPreview data={value} defaultExpanded />
        </LazyPreviewDetails>
      );
    }
    return <span className="param-list-str">{value}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="param-list-empty-arr">[]</span>;
    }
    const allPrimitive =
      value.length <= 4 &&
      value.every(
        (v) =>
          v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean',
      );
    if (allPrimitive && value.length <= 4) {
      // Tighter inline-array threshold (was 8) so we don't push a long
      // array onto the same row as other params; anything bigger now
      // folds into the details drill-down.
      return (
        <span className="param-list-arr-inline">
          [
          {value.map((v, i) => {
            const key = `${i}:${v === null || v === undefined ? '__null' : String(v).slice(0, 16)}`;
            return (
              <span key={key} className="param-list-arr-item">
                {i > 0 && ', '}
                <ParamValue value={v} />
              </span>
            );
          })}
          ]
        </span>
      );
    }
    return (
      <LazyPreviewDetails
        className="param-list-nested"
        initialOpen={isInsideExpandedCard}
        summary={`${value.length} 项`}
      >
        <JsonPreview data={value} defaultExpanded />
      </LazyPreviewDetails>
    );
  }
  if (typeof value === 'object') {
    const { keys, more } = previewKeys(value, PREVIEW_PAGE_SIZE);
    return (
      <LazyPreviewDetails
        className="param-list-nested"
        initialOpen={isInsideExpandedCard}
        summary={`对象 · ${keys.length}${more ? '+' : ''} 键`}
      >
        <JsonPreview data={value} defaultExpanded />
      </LazyPreviewDetails>
    );
  }
  return <span className="param-list-str">{String(value)}</span>;
}

/**
 * Inline key/value rendering of a tool's input parameters. All entries
 * share a single wrap-friendly flex row separated by middots; long values
 * compact into `<details>` so the row never explodes vertically.
 *
 * Replaces the previous `<dl>` grid that gave every parameter its own row
 * — params are secondary context, so the panel should stay one short
 * sentence wherever possible.
 */
export function ParameterListPreview({ input }: { input: Record<string, unknown> }) {
  const [limit, setLimit] = useState(PREVIEW_PAGE_SIZE);
  const { keys, more } = previewKeys(input, limit);
  if (keys.length === 0) {
    return <div className="param-list-empty">（无参数）</div>;
  }
  return (
    <div className="param-list">
      {keys.map((key, i) => (
        <span key={key} className="param-list-row">
          {i > 0 && (
            <span className="param-list-sep" aria-hidden="true">
              ·
            </span>
          )}
          <span className="param-list-key">{key}</span>
          <span className="param-list-value">
            <ParamValue value={input[key]} />
          </span>
        </span>
      ))}
      {more && (
        <PreviewMore onClick={() => setLimit((count) => count + PREVIEW_PAGE_SIZE)}>
          加载更多字段
        </PreviewMore>
      )}
    </div>
  );
}
