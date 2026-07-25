import { isPublicHttpUrl } from './open-websearch-url.js';

export function readHeaderValue(
  headers: Record<string, string | readonly string[] | undefined>,
  name: string,
): string {
  const value = headers[name];
  return typeof value === 'string' ? value : (value?.[0] ?? '');
}

export function extractReadableContent(input: {
  readonly contentType: string;
  readonly finalUrl: string;
  readonly raw: string;
}): string {
  if (isMarkdownPath(input.finalUrl) || isMarkdownContentType(input.contentType)) {
    return normalizeText(input.raw);
  }

  if (!looksLikeHtml(input.contentType, input.raw)) {
    return normalizeText(input.raw);
  }

  const documentHtml = selectDocumentContentHtml(input.raw);
  const selectedContent = htmlToText(documentHtml);
  if (selectedContent.length > 0) {
    return selectedContent;
  }

  const fallback = [extractTitle(input.raw), extractMetaDescription(input.raw)]
    .filter((value) => value.length > 0)
    .join('\n\n');
  return normalizeText(fallback);
}

export function extractTitle(html: string): string {
  return normalizeText(extractSingleTagContent(html, 'title') ?? '');
}

export function extractDocumentLinks(
  html: string,
  baseUrl: string,
): readonly { readonly href: string; readonly text: string }[] {
  const links: Array<{ readonly href: string; readonly text: string }> = [];
  const seenHrefs = new Set<string>();
  const pattern = /<a\b[^>]*href\s*=\s*(['"])(.*?)\1[^>]*>([\s\S]*?)<\/a>/giu;

  for (const match of html.matchAll(pattern)) {
    const hrefValue = match[2];
    const rawText = match[3];
    if (!hrefValue || !rawText) {
      continue;
    }

    let href: string;
    try {
      href = new URL(hrefValue, baseUrl).toString();
    } catch {
      continue;
    }

    if (!isPublicHttpUrl(href) || seenHrefs.has(href)) {
      continue;
    }

    const text = htmlToText(rawText);
    seenHrefs.add(href);
    links.push({ href, text });
  }

  return links;
}

export function looksLikeHtml(contentType: string, raw: string): boolean {
  if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
    return true;
  }

  return /<!doctype html|<html[\s>]|<body[\s>]/iu.test(raw);
}

export function selectDocumentContentHtml(html: string): string {
  const cleanedHtml = stripIgnoredTags(html);
  const candidates = [
    extractTagBlock(cleanedHtml, 'article'),
    extractTagBlock(cleanedHtml, 'main'),
    extractRoleMainBlock(cleanedHtml),
    extractClassBlock(cleanedHtml, 'markdown-body'),
    extractClassBlock(cleanedHtml, 'article-content'),
    extractClassBlock(cleanedHtml, 'post-content'),
    extractClassBlock(cleanedHtml, 'entry-content'),
    extractClassBlock(cleanedHtml, 'content'),
    extractTagBlock(cleanedHtml, 'body'),
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const text = htmlToText(candidate);
    if (text.length >= 120) {
      return candidate;
    }
  }

  return candidates.find((candidate) => candidate !== null) ?? cleanedHtml;
}

function stripIgnoredTags(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/gu, ' ')
    .replace(/<(script|style|noscript|template|iframe|svg|canvas)\b[\s\S]*?<\/\1>/giu, ' ');
}

function extractMetaDescription(html: string): string {
  return normalizeText(
    readMetaContent(html, 'name', 'description') ??
      readMetaContent(html, 'property', 'og:description') ??
      '',
  );
}

function readMetaContent(
  html: string,
  attribute: 'name' | 'property',
  value: string,
): string | null {
  const escaped = escapeForRegExp(value);
  const patterns = [
    new RegExp(
      `<meta\\b[^>]*${attribute}\\s*=\\s*(['"])${escaped}\\1[^>]*content\\s*=\\s*(['"])([\\s\\S]*?)\\2[^>]*>`,
      'iu',
    ),
    new RegExp(
      `<meta\\b[^>]*content\\s*=\\s*(['"])([\\s\\S]*?)\\1[^>]*${attribute}\\s*=\\s*(['"])${escaped}\\3[^>]*>`,
      'iu',
    ),
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (!match) {
      continue;
    }

    const content = match[3] ?? match[2];
    return typeof content === 'string' ? decodeBasicEntities(content) : null;
  }

  return null;
}

function extractTagBlock(html: string, tagName: string): string | null {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'iu');
  return pattern.exec(html)?.[1] ?? null;
}

function extractRoleMainBlock(html: string): string | null {
  return extractPatternBlock(
    html,
    /<([a-z0-9:-]+)\b[^>]*role\s*=\s*(['"])main\2[^>]*>([\s\S]*?)<\/\1>/iu,
  );
}

function extractClassBlock(html: string, className: string): string | null {
  return extractPatternBlock(
    html,
    new RegExp(
      `<([a-z0-9:-]+)\\b[^>]*class\\s*=\\s*(['"])[^'"]*\\b${escapeForRegExp(className)}\\b[^'"]*\\2[^>]*>([\\s\\S]*?)<\\/\\1>`,
      'iu',
    ),
  );
}

function extractPatternBlock(html: string, pattern: RegExp): string | null {
  const match = pattern.exec(html);
  return match?.[3] ?? null;
}

function extractSingleTagContent(html: string, tagName: string): string | null {
  const block = extractTagBlock(html, tagName);
  return block === null ? null : htmlToText(block);
}

function htmlToText(html: string): string {
  return normalizeText(
    decodeBasicEntities(
      html
        .replace(/<br\s*\/?>/giu, '\n')
        .replace(/<\/(p|div|section|article|main|li|tr|h[1-6])>/giu, '\n')
        .replace(/<[^>]+>/gu, ' '),
    ),
  );
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'");
}

function isMarkdownPath(value: string): boolean {
  const pathname = new URL(value).pathname.toLowerCase();
  return pathname.endsWith('.md') || pathname.endsWith('.markdown') || pathname.endsWith('.mdx');
}

function isMarkdownContentType(contentType: string): boolean {
  return (
    contentType.includes('text/markdown') ||
    contentType.includes('application/markdown') ||
    contentType.includes('text/x-markdown')
  );
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
