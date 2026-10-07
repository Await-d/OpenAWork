import type { ArtifactContentType, ArtifactRecord } from '@openAwork/artifacts';
import { parseDelimitedPreview } from '../../../utils/file/parse-delimited-preview.js';

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
  return (
    type === 'html' ||
    type === 'svg' ||
    type === 'markdown' ||
    // mermaid 的虚拟扩展名是 `.mmd`，交给 FilePreviewPane 的 chart 分支渲染。
    type === 'mermaid' ||
    type === 'csv' ||
    type === 'image'
  );
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

/** 产物侧 CSV 行上限：预览只是「快速核对字段」，25 行足够且不占版面。 */
const ARTIFACT_CSV_PREVIEW_ROWS = 25;

/**
 * 产物 CSV 预览解析。实现已迁到 `utils/file/parse-delimited-preview.ts`
 * （工作区 `.csv` 文件预览与产物预览共用同一份），这里保留 25 行的
 * 产物侧行上限。
 */
export function parseCsvPreview(content: string): { headers: string[]; rows: string[][] } {
  const { headers, rows } = parseDelimitedPreview(content, ',', ARTIFACT_CSV_PREVIEW_ROWS);
  return { headers, rows };
}

export function buildSvgPreviewDocument(content: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      /* 沙箱文档不继承宿主 token，故用字面色 */
      html, body {
        margin: 0;
        min-height: 100%;
        background: #ffffff;
        color: #1a1a1a;
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
