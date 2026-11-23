/**
 * Helpers for rendering webfetch / websearch / google_search outputs.
 * Strips boilerplate HTML/JS noise and extracts result lists from
 * search-engine response bodies.
 */
import {
  extractWebStructuredResults,
  extractWebStructuredResultsFromValue,
  type WebStructuredResults,
} from './web-structured-results.js';

/**
 * web 类工具名判定：共用「网页摘要 / 搜索结果」渲染分支。
 *
 * 四个入口都要算进来，否则同类工具会出现两套观感：
 * - `webfetch`（网关抓取）、`websearch` / `google_search`（网关搜索别名）；
 * - `web_search`（agent-core 内置搜索）—— 输出是 `1. 标题 / 摘要 / URL` 文本，
 *   `extractWebSummary` 的纯文本分支能直接解析成搜索结果列表。
 */
export function isWebToolName(toolName: string): boolean {
  const normalized = toolName.trim().toLowerCase();
  return (
    normalized === 'webfetch' ||
    normalized === 'websearch' ||
    normalized === 'web_search' ||
    normalized === 'google_search'
  );
}

/**
 * 「搜索」类工具判定。
 *
 * 与 `isWebToolName` 分开是因为**两者的正文语义不同**，而这个差别只能靠工具名区分、
 * 靠内容形状区分不了：
 * - 搜索工具（`websearch` / `web_search` / `google_search`）的正文**就是**结果列表，
 *   正文里的 `1. 标题 / 摘要 / URL` 应当拆成结果卡片；
 * - `webfetch` 的正文是**页面内容**——页面自己的编号列表（比如 HN 首页的条目）
 *   不是搜索结果，按结果列表拆会得到一堆错位的 title / snippet。
 *
 * 两者产出的是同一种形状（网关都是抓一个 URL 再转文本），所以「是不是搜索」
 * 必须由调用方按工具名传入，不能由 `extractWebSummary` 自己猜。
 */
export function isSearchToolName(toolName: string): boolean {
  const normalized = toolName.trim().toLowerCase();
  return (
    normalized === 'websearch' || normalized === 'web_search' || normalized === 'google_search'
  );
}

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

/**
 * Markdown 正文的清洗：只做「不会破坏结构」的归一化。
 *
 * **不能套用 `cleanWebContent`** —— 它会删掉空行、压平行首缩进，而 Markdown 恰恰靠这两样
 * 表达段落、列表与代码块。空行一没，相邻行就会被当成同一个段落，整页挤成一坨。
 * 实测（`webfetch` 抓 HTML 页、网关 turndown 出的 Markdown）：正文里 2 个空行被删成 0 个，
 * `1. …` 列表项与上一行 `login` 直接连成一句。
 */
function cleanMarkdownContent(raw: string): string {
  return (
    raw
      .replace(/\r\n?/g, '\n')
      // 折叠过多空行，但**保留**段间那一个 —— 它就是段落分隔本身。
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+$/gm, '')
      .trim()
  );
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
  mediaKind?: 'image';
  imageUrl?: string;
  content: string;
  cleanedContent: string;
  isMarkdown: boolean;
  searchResults: SearchResultItem[] | null;
  /**
   * 结构化 API 响应（GitHub 仓库 / 用户 / 通用记录）。命中时由 `WebResultCards`
   * 渲染成卡片，替代「原始 JSON 纯文本平铺」这条路径。
   */
  structuredResults: WebStructuredResults | null;
  /**
   * `content` 是否被前端截断过。体积上限是静默施加的，若不告知，「原始响应」
   * 折叠区看起来就是完整响应，排查时会被误导。
   */
  contentTruncated: boolean;
}

/** 字符串形态输出的正文上限。 */
const STRING_CONTENT_LIMIT = 4000;
/** 对象形态输出（`{ url, status, content }`）的正文上限。 */
const OBJECT_CONTENT_LIMIT = 8000;

function isPreviewableImageUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function extractWebSummary(
  output: unknown,
  /**
   * 正文是否来自「搜索」类工具。**必填**：只有调用方知道工具名，而搜索结果识别一旦
   * 用错对象（抓正文时也跑）就会把页面自己的编号列表拆成结果卡片。见 `isSearchToolName`。
   */
  options: { searchTool: boolean },
): WebSummary {
  if (typeof output !== 'object' || output === null) {
    const text = typeof output === 'string' ? output : '';
    const cleaned = cleanWebContent(text);
    const markdown = isMarkdownContent(text);
    return {
      content: text.slice(0, STRING_CONTENT_LIMIT),
      // Markdown 走保留结构的清洗，否则段落会被压成一坨（见 `cleanMarkdownContent`）。
      cleanedContent: (markdown ? cleanMarkdownContent(text) : cleaned).slice(
        0,
        STRING_CONTENT_LIMIT,
      ),
      isMarkdown: markdown,
      searchResults: options.searchTool ? extractSearchResults(cleaned) : null,
      // 必须在 `cleanWebContent` 之前用原始文本识别：清洗会剥掉 `{...}`，
      // 而结构化识别恰恰依赖那段 JSON 字面量。
      structuredResults: extractWebStructuredResults(text),
      contentTruncated: text.length > STRING_CONTENT_LIMIT,
    };
  }
  const obj = output as Record<string, unknown>;
  const url = typeof obj.url === 'string' ? obj.url : undefined;
  const status = typeof obj.status === 'number' ? obj.status : undefined;
  const contentType = typeof obj.contentType === 'string' ? obj.contentType : undefined;
  const format = typeof obj.format === 'string' ? obj.format : undefined;
  const mediaKind = obj.mediaKind === 'image' ? 'image' : undefined;
  const candidateImageUrl =
    typeof obj.imageUrl === 'string'
      ? obj.imageUrl
      : mediaKind === 'image' && typeof obj.url === 'string'
        ? obj.url
        : undefined;
  const imageUrl =
    candidateImageUrl && isPreviewableImageUrl(candidateImageUrl) ? candidateImageUrl : undefined;
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
    ...(mediaKind ? { mediaKind } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    content: content.slice(0, OBJECT_CONTENT_LIMIT),
    // 同上：Markdown 必须走保留空行与缩进的清洗，否则段落会被并成一坨。
    cleanedContent: (isMd ? cleanMarkdownContent(content) : cleaned).slice(0, OBJECT_CONTENT_LIMIT),
    isMarkdown: isMd,
    searchResults: options.searchTool ? extractSearchResults(cleaned) : null,
    // 同上：识别基于未清洗的 `content`，否则 `{...}` 已被剥掉。正文识别不出时再退到
    // 「整体对象」——搜索信封（`{ query, results }`）本身没有 `content` / `output`。
    structuredResults:
      extractWebStructuredResults(content) ?? extractWebStructuredResultsFromValue(obj),
    contentTruncated: content.length > OBJECT_CONTENT_LIMIT,
  };
}
