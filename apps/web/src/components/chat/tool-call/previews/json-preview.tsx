import { useMemo } from 'react';
import { CopyBtn } from '../shared/copy-btn.js';

/**
 * JSON 输出预览组件，带语法高亮
 * 自动识别 JSON 格式并美化显示
 */
export function JsonPreview({
  data,
  defaultExpanded = false,
  maxLines = 20,
}: {
  data: unknown;
  defaultExpanded?: boolean;
  maxLines?: number;
}) {
  const jsonString = useMemo(() => {
    return typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  }, [data]);

  const lines = jsonString.split('\n');
  const shouldCollapse = lines.length > maxLines;

  return (
    <div className="json-preview">
      <div className="json-preview-header">
        <span className="json-preview-meta">{lines.length} 行</span>
        <CopyBtn text={jsonString} />
      </div>
      <div className="json-preview-content" data-collapsed={shouldCollapse && !defaultExpanded}>
        <pre className="json-preview-code">
          <code dangerouslySetInnerHTML={{ __html: highlightJson(jsonString) }} />
        </pre>
      </div>
    </div>
  );
}

/**
 * 简单的 JSON 语法高亮
 * 支持：键名、字符串、数字、布尔值、null
 */
function highlightJson(json: string): string {
  return json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(
      /"([^"]+)":/g,
      '<span class="json-key">"$1"</span><span class="json-colon">:</span>',
    )
    .replace(/"([^"]*)"/g, '<span class="json-string">"$1"</span>')
    .replace(/\b(true|false)\b/g, '<span class="json-boolean">$1</span>')
    .replace(/\bnull\b/g, '<span class="json-null">null</span>')
    .replace(/\b(-?\d+\.?\d*)\b/g, '<span class="json-number">$1</span>');
}
