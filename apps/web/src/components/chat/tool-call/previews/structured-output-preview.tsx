import { ParamValue } from './parameter-list-preview.js';

/**
 * Friendly last-resort renderer for structured tool output objects. Replaces a
 * bare `JSON.stringify` dump with one readable row per top-level field; nested
 * objects / long strings stay drill-able through `ParamValue`'s `<details>`.
 */
export function StructuredOutputPreview({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) {
    return <div className="param-list-empty">（空对象）</div>;
  }

  return (
    <div className="structured-output">
      <div className="structured-output-header">{entries.length} 个字段</div>
      <div className="structured-output-rows">
        {entries.map(([key, value]) => (
          <div className="structured-output-row" key={key}>
            <span className="structured-output-key">{key}</span>
            <span className="structured-output-value">
              <ParamValue value={value} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
