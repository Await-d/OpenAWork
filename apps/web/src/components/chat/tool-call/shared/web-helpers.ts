/**
 * Helpers for rendering webfetch / websearch / google_search outputs.
 * Strips boilerplate HTML/JS noise and extracts result lists from
 * search-engine response bodies.
 */

export function cleanWebContent(raw: string): string {
  let text = raw;
  text = text.replace(/\/\/<!\[CDATA\[[\s\S]*?\/\/\]\]>/g, '');
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<\/?[a-zA-Z][a-zA-Z0-9]*(?:\s[^>]*)?\/?>/g, '');
  text = text.replace(/&#\d+;/g, ' ');
  text = text.replace(/&[a-zA-Z]+;/g, ' ');
  text = text.replace(/\{[^}]*\}/g, '');
  text = text.replace(/(?:var|let|const|function)\s+\w+\s*=[^;]*;/g, '');
  text = text.replace(/\w+\.\w+\s*=\s*[^;]+;/g, '');
  text = text.replace(/\\u[0-9a-fA-F]{4}/g, '');
  text = text.replace(/\\x[0-9a-fA-F]{2}/g, '');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/[ \t]+/g, ' ');
  text = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n');
  return text;
}

export interface SearchResultItem {
  title: string;
  snippet: string;
  url?: string;
}

export function extractSearchResults(cleaned: string): SearchResultItem[] | null {
  const lines = cleaned.split('\n');
  const results: SearchResultItem[] = [];
  let i = 0;
  while (i < lines.length && !/^\d+\.\s/.test(lines[i]!)) i++;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    const numMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (!numMatch) continue;
    const title = numMatch[2]?.trim();
    const snippetLines: string[] = [];
    let url: string | undefined;
    let j = i + 1;
    while (
      j < lines.length &&
      !/^(\d+)\.\s/.test(lines[j]!) &&
      !/^\*?\s*(Privacy|Terms|Next|Pagination)/.test(lines[j]!)
    ) {
      const sl = lines[j]?.trim();
      if (sl) {
        // Detect standalone URL lines (http/https)
        const urlMatch = sl.match(/^https?:\/\/\S+$/);
        if (urlMatch && !url) {
          url = urlMatch[0];
        } else {
          // Also detect "URL: ..." or "Link: ..." prefixes
          const prefixedUrl = sl.match(/^(?:URL|Link|Source):\s*(https?:\/\/\S+)$/i);
          if (prefixedUrl && !url) {
            url = prefixedUrl[1];
          } else {
            snippetLines.push(sl);
          }
        }
      }
      j++;
    }
    const snippet = snippetLines.join(' ').slice(0, 200);
    if (title && title.length > 2) {
      results.push({ title, snippet, url });
    }
    if (results.length >= 8) break;
  }
  return results.length >= 2 ? results : null;
}

export function isMarkdownContent(text: string): boolean {
  let score = 0;
  if (/^#{1,3}\s/m.test(text)) score++;
  if (/\*\*[^*]+\*\*/.test(text)) score++;
  if (/\[.+\]\(.+\)/.test(text)) score++;
  if (/^\s*[-*]\s/m.test(text)) score++;
  if (/^\s*\d+\.\s/m.test(text)) score++;
  if (/^>\s/m.test(text)) score++;
  if (/`[^`]+`/.test(text)) score++;
  return score >= 2;
}

export interface WebSummary {
  url?: string;
  status?: number;
  contentType?: string;
  format?: string;
  content: string;
  cleanedContent: string;
  isMarkdown: boolean;
  searchResults: SearchResultItem[] | null;
  lineCount: number;
}

export function extractWebSummary(output: unknown): WebSummary {
  if (typeof output !== 'object' || output === null) {
    const text = typeof output === 'string' ? output : '';
    const cleaned = cleanWebContent(text);
    return {
      content: text.slice(0, 4000),
      cleanedContent: cleaned.slice(0, 4000),
      isMarkdown: isMarkdownContent(text),
      searchResults: extractSearchResults(cleaned),
      lineCount: cleaned.split('\n').length,
    };
  }
  const obj = output as Record<string, unknown>;
  const url = typeof obj.url === 'string' ? obj.url : undefined;
  const status = typeof obj.status === 'number' ? obj.status : undefined;
  const contentType = typeof obj.contentType === 'string' ? obj.contentType : undefined;
  const format = typeof obj.format === 'string' ? obj.format : undefined;
  const content =
    typeof obj.content === 'string'
      ? obj.content
      : typeof obj.output === 'string'
        ? obj.output
        : '';
  const cleaned = cleanWebContent(content);
  const isMd = format === 'markdown' || isMarkdownContent(content) || isMarkdownContent(cleaned);
  return {
    url,
    status,
    contentType,
    format,
    content: content.slice(0, 8000),
    cleanedContent: cleaned.slice(0, 8000),
    isMarkdown: isMd,
    searchResults: extractSearchResults(cleaned),
    lineCount: cleaned.split('\n').length,
  };
}
