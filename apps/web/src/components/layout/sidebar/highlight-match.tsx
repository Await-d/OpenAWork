import type { ReactNode } from 'react';

/**
 * 把文本中命中搜索词的首个片段用 `<mark>` 高亮。
 * 未命中或搜索词为空时原样返回文本。
 */
export function highlightMatch(text: string, query: string): ReactNode {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return text;
  }

  const index = text.toLowerCase().indexOf(normalizedQuery);
  if (index < 0) {
    return text;
  }

  return (
    <>
      {text.slice(0, index)}
      <mark className="session-title-match">
        {text.slice(index, index + normalizedQuery.length)}
      </mark>
      {text.slice(index + normalizedQuery.length)}
    </>
  );
}
