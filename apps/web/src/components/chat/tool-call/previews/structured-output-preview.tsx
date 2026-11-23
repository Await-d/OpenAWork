import { useState } from 'react';
import { ParamValue } from './parameter-list-preview.js';
import { LazyPreviewCopy, PreviewMore, previewKeys, PREVIEW_PAGE_SIZE } from './bounded-preview.js';

/**
 * Friendly last-resort renderer for structured tool output objects. Replaces a
 * bare `JSON.stringify` dump with one readable row per top-level field; nested
 * objects / long strings stay drill-able through `ParamValue`'s `<details>`.
 */
export function StructuredOutputPreview({ data }: { data: Record<string, unknown> }) {
  const [limit, setLimit] = useState(PREVIEW_PAGE_SIZE);
  const { keys, more } = previewKeys(data, limit);
  if (keys.length === 0) {
    return <div className="param-list-empty">（空对象）</div>;
  }

  return (
    <div className="structured-output">
      <div className="structured-output-header">
        {keys.length}
        {more ? '+' : ''} 个字段 <LazyPreviewCopy data={data} />
      </div>
      <div className="structured-output-rows">
        {keys.map((key) => (
          <div className="structured-output-row" key={key}>
            <span className="structured-output-key">{key}</span>
            <span className="structured-output-value">
              <ParamValue value={data[key]} />
            </span>
          </div>
        ))}
      </div>
      {more && (
        <PreviewMore onClick={() => setLimit((count) => count + PREVIEW_PAGE_SIZE)}>
          加载更多字段
        </PreviewMore>
      )}
    </div>
  );
}
