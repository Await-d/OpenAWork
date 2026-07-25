import {
  buildAxiosRequestOptions,
  requestWithSafeRedirects,
} from 'open-websearch/build/utils/httpRequest.js';
import {
  extractDocumentLinks,
  extractReadableContent,
  extractTitle,
  looksLikeHtml,
  readHeaderValue,
  selectDocumentContentHtml,
} from './open-websearch-html.js';

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024;
const CONTENT_HEADERS = {
  Accept:
    'text/markdown,text/plain,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
} as const;

export interface OpenWebSearchFetchWebInput {
  readonly includeLinks?: boolean;
  readonly maxChars: number;
  readonly readability?: boolean;
  readonly url: string;
}

export interface OpenWebSearchFetchWebLink {
  readonly href: string;
  readonly text: string;
}

export interface OpenWebSearchFetchWebResult {
  readonly content: string;
  readonly contentType: string;
  readonly finalUrl: string;
  readonly links?: readonly OpenWebSearchFetchWebLink[];
  readonly retrievalMethod: 'request';
  readonly title: string;
  readonly truncated: boolean;
  readonly url: string;
}

export async function fetchOpenWebSearchPage(
  input: OpenWebSearchFetchWebInput,
): Promise<OpenWebSearchFetchWebResult> {
  const response = await requestWithSafeRedirects(
    'GET',
    input.url,
    buildAxiosRequestOptions({
      decompress: true,
      headers: CONTENT_HEADERS,
      maxBodyLength: MAX_DOWNLOAD_BYTES,
      maxContentLength: MAX_DOWNLOAD_BYTES,
      maxRedirects: 5,
      responseType: 'text',
      timeout: DEFAULT_TIMEOUT_MS,
    }),
    'Request URL',
  );

  const contentType = readHeaderValue(response.headers, 'content-type').toLowerCase();
  const finalUrl = response.request?.res?.responseUrl ?? input.url;
  const raw =
    typeof response.data === 'string' ? response.data : JSON.stringify(response.data, null, 2);
  const title = looksLikeHtml(contentType, raw) ? extractTitle(raw) : '';
  const content = extractReadableContent({
    contentType,
    finalUrl,
    raw,
  });
  const truncated = content.length > input.maxChars;

  return {
    url: input.url,
    finalUrl,
    contentType,
    title,
    retrievalMethod: 'request',
    truncated,
    content: truncated ? content.slice(0, input.maxChars) : content,
    ...(input.includeLinks === true
      ? { links: extractDocumentLinks(selectDocumentContentHtml(raw), finalUrl) }
      : {}),
  };
}
