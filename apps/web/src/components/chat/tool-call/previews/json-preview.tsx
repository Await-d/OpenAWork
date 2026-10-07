import { useMemo, useState } from 'react';
import { CopyBtn } from '../shared/copy-btn.js';
import { useIsInsideExpandedToolCard } from '../shared/tool-card-expansion.js';

/** 折叠态最多渲染的字符数：MB 级输出不能全量生成 HTML 字符串 + DOM。 */
const MAX_RENDERED_CHARS = 20_000;

/**
 * 展开态的硬上限。用户主动点「展开全部」后仍需有天花板，否则一个几 MB 的
 * JSON 响应就能在一次点击里把主线程卡死数秒。
 */
const MAX_EXPANDED_CHARS = 200_000;

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

  const isInsideExpandedToolCard = useIsInsideExpandedToolCard();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const effectiveExpanded = expanded || isInsideExpandedToolCard;

  const view = useMemo(() => {
    const lineCount = countLines(jsonString);

    if (effectiveExpanded) {
      if (jsonString.length > MAX_EXPANDED_CHARS) {
        // 展开态也必须有天花板：否则一个几 MB 的响应就能在一次点击里卡死主线程。
        const head = jsonString.slice(0, MAX_EXPANDED_CHARS);
        return {
          lineCount,
          rendered: head,
          clipped: true,
        };
      }
      return { lineCount, rendered: jsonString, clipped: false };
    }

    // 折叠态：行级截断到 maxLines，再兜一层字符上限。
    // 旧实现只是把 max-height 从 400px 改成 300px，全文始终进 DOM。
    const lines = jsonString.split('\n');
    const head = (lines.length > maxLines ? lines.slice(0, maxLines) : lines).join('\n');
    return {
      lineCount,
      rendered: head.length > MAX_RENDERED_CHARS ? head.slice(0, MAX_RENDERED_CHARS) : head,
      clipped: head.length > MAX_RENDERED_CHARS,
    };
  }, [jsonString, effectiveExpanded, maxLines]);

  const html = useMemo(() => highlightJson(view.rendered), [view.rendered]);
  const canToggle = view.lineCount > maxLines && !isInsideExpandedToolCard && !view.clipped;

  return (
    <div className="json-preview">
      <div className="json-preview-header">
        <span className="json-preview-meta">
          {view.lineCount} 行{view.clipped ? ` · 已截断显示前 ${view.rendered.length} 字符` : ''}
        </span>
        <CopyBtn text={jsonString} />
      </div>
      <div
        className="json-preview-content"
        data-collapsed={view.lineCount > maxLines && !effectiveExpanded}
      >
        <pre className="json-preview-code">
          <code dangerouslySetInnerHTML={{ __html: html }} />
        </pre>
      </div>
      {view.clipped && (
        <span className="json-preview-meta json-preview-clipped-hint">
          内容过大，仅展示前 {view.rendered.length} 字符（共 {jsonString.length} 字符）
        </span>
      )}
      {canToggle && (
        <button type="button" className="tool-output-toggle" onClick={() => setExpanded((v) => !v)}>
          {effectiveExpanded ? '收起' : `展开全部 (${view.lineCount} 行)`}
        </button>
      )}
    </div>
  );
}

function countLines(text: string): number {
  return text.length === 0 ? 0 : text.split('\n').length;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * JSON token：键、字符串、布尔、null、数字。
 *
 * 顺序有意义——带冒号的字符串必须排在普通字符串前面，否则 `"a": 1` 的键会被
 * 当成普通字符串，冒号失去高亮。
 */
const JSON_TOKEN =
  /("(?:\\.|[^"\\])*")(\s*:)|("(?:\\.|[^"\\])*")|(true|false)\b|(null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

/**
 * 单遍扫描的 JSON 语法高亮。
 *
 * 历史实现是连续 4 次 `String.replace`：第 2 步刚注入的 `<span class="json-key">`
 * 会被第 3 步 `/"([^"]*)"/g` 当成 JSON 字符串再替换一次，把刚生成的 `class` 属性
 * 撕成 `class=<span class="json-string">"json-key"</span>>`，于是**所有含键的 JSON
 * 都渲染出破碎 DOM**。单遍 token 化不存在自我污染，且只转义一次。
 */
function highlightJson(json: string): string {
  const pattern = new RegExp(JSON_TOKEN.source, 'g');
  let out = '';
  let last = 0;
  let match = pattern.exec(json);

  while (match !== null) {
    const [raw, key, colon, str, bool, nul, num] = match;
    out += escapeHtml(json.slice(last, match.index));

    if (key !== undefined) {
      out += `<span class="json-key">${escapeHtml(key)}</span>`;
      out += `<span class="json-colon">${escapeHtml(colon ?? '')}</span>`;
    } else if (str !== undefined) {
      out += `<span class="json-string">${escapeHtml(str)}</span>`;
    } else if (bool !== undefined) {
      out += `<span class="json-boolean">${escapeHtml(bool)}</span>`;
    } else if (nul !== undefined) {
      out += `<span class="json-null">null</span>`;
    } else if (num !== undefined) {
      out += `<span class="json-number">${escapeHtml(num)}</span>`;
    } else {
      out += escapeHtml(raw);
    }

    last = match.index + raw.length;
    match = pattern.exec(json);
  }

  return out + escapeHtml(json.slice(last));
}
