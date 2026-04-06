import type { ArtifactContentType, ArtifactRecord } from '@openAwork/artifacts';

const ARTIFACT_FILE_EXTENSION: Record<ArtifactContentType, string> = {
  code: 'txt',
  html: 'html',
  react: 'tsx',
  svg: 'svg',
  mermaid: 'mmd',
  markdown: 'md',
  csv: 'csv',
  image: 'png',
  document: 'bin',
};

export function formatArtifactTypeLabel(type: ArtifactContentType): string {
  switch (type) {
    case 'html':
      return 'HTML';
    case 'react':
      return 'React';
    case 'svg':
      return 'SVG';
    case 'mermaid':
      return 'Mermaid';
    case 'markdown':
      return 'Markdown';
    case 'csv':
      return 'CSV';
    case 'image':
      return 'Image';
    case 'document':
      return 'Document';
    default:
      return 'Code';
  }
}

export function formatArtifactTimestamp(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function getArtifactEditorLanguage(type: ArtifactContentType): string {
  switch (type) {
    case 'html':
      return 'html';
    case 'react':
      return 'typescript';
    case 'svg':
      return 'xml';
    case 'markdown':
      return 'markdown';
    case 'csv':
      return 'plaintext';
    case 'mermaid':
      return 'markdown';
    default:
      return 'plaintext';
  }
}

export function canPreviewArtifact(type: ArtifactContentType): boolean {
  return type === 'html' || type === 'svg' || type === 'markdown' || type === 'csv';
}

function normalizeFileStem(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) {
    return 'untitled-artifact';
  }
  return trimmed.replace(/[\\/:*?"<>|]+/g, '-');
}

export function buildArtifactVirtualPath(artifact: Pick<ArtifactRecord, 'title' | 'type'>): string {
  const extension = ARTIFACT_FILE_EXTENSION[artifact.type] ?? 'bin';
  const normalizedTitle = normalizeFileStem(artifact.title);
  if (normalizedTitle.toLowerCase().endsWith(`.${extension.toLowerCase()}`)) {
    return normalizedTitle;
  }
  return `${normalizedTitle}.${extension}`;
}

export function buildArtifactDownloadName(
  artifact: Pick<ArtifactRecord, 'title' | 'type'>,
): string {
  return buildArtifactVirtualPath(artifact);
}

export function parseCsvPreview(content: string): { headers: string[]; rows: string[][] } {
  const parsedRows = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 25)
    .map((line) => line.split(',').map((cell) => cell.trim()));
  if (parsedRows.length === 0) {
    return { headers: [], rows: [] };
  }
  const headers = parsedRows[0];
  if (!headers) {
    return { headers: [], rows: [] };
  }
  const bodyRows = parsedRows.slice(1);
  return { headers, rows: bodyRows };
}

export function buildSvgPreviewDocument(content: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body {
        margin: 0;
        min-height: 100%;
        background: #ffffff;
      }
      body {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        box-sizing: border-box;
      }
      svg {
        max-width: 100%;
        max-height: calc(100vh - 32px);
      }
    </style>
  </head>
  <body>
    ${content}
  </body>
</html>`;
}
