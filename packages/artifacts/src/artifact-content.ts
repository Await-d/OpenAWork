export const ARTIFACT_CONTENT_TYPES = [
  'code',
  'html',
  'react',
  'svg',
  'mermaid',
  'markdown',
  'csv',
  'image',
  'document',
] as const;

export type ArtifactContentType = (typeof ARTIFACT_CONTENT_TYPES)[number];

export type ArtifactRenderStrategy =
  | 'inline-text'
  | 'iframe-sandbox'
  | 'inline-svg'
  | 'image'
  | 'download';

export interface ArtifactTypeConfig {
  renderStrategy: ArtifactRenderStrategy;
  editable: boolean;
  livePreview: boolean;
  mimeType: string;
  fileExtension: string;
}

export interface ArtifactMetadata {
  source?: string;
  workspaceRoot?: string | null;
  originMessageId?: string | null;
  [key: string]: unknown;
}

export interface ArtifactRecord {
  id: string;
  sessionId: string;
  userId: string;
  type: ArtifactContentType;
  title: string;
  content: string;
  version: number;
  parentVersionId: string | null;
  metadata: ArtifactMetadata;
  createdAt: string;
  updatedAt: string;
}

export type ArtifactVersionActor = 'agent' | 'user' | 'system';

export interface ArtifactLineChange {
  lineNumber: number;
  kind: 'added' | 'removed' | 'modified';
  before?: string;
  after?: string;
}

export interface ArtifactVersionRecord {
  id: string;
  artifactId: string;
  versionNumber: number;
  content: string;
  diffFromPrevious: ArtifactLineChange[];
  createdBy: ArtifactVersionActor;
  createdByNote: string | null;
  createdAt: string;
}

export interface ArtifactDraftInput {
  title: string;
  content: string;
  type?: ArtifactContentType | null;
  fileName?: string | null;
  mimeType?: string | null;
}

export const ARTIFACT_TYPE_CONFIG: Record<ArtifactContentType, ArtifactTypeConfig> = {
  code: {
    renderStrategy: 'inline-text',
    editable: true,
    livePreview: false,
    mimeType: 'text/plain',
    fileExtension: 'txt',
  },
  html: {
    renderStrategy: 'iframe-sandbox',
    editable: true,
    livePreview: true,
    mimeType: 'text/html',
    fileExtension: 'html',
  },
  react: {
    renderStrategy: 'inline-text',
    editable: true,
    livePreview: false,
    mimeType: 'text/plain',
    fileExtension: 'tsx',
  },
  svg: {
    renderStrategy: 'inline-svg',
    editable: true,
    livePreview: true,
    mimeType: 'image/svg+xml',
    fileExtension: 'svg',
  },
  mermaid: {
    renderStrategy: 'inline-text',
    editable: true,
    livePreview: false,
    mimeType: 'text/plain',
    fileExtension: 'mmd',
  },
  markdown: {
    renderStrategy: 'inline-text',
    editable: true,
    livePreview: false,
    mimeType: 'text/markdown',
    fileExtension: 'md',
  },
  csv: {
    renderStrategy: 'inline-text',
    editable: true,
    livePreview: false,
    mimeType: 'text/csv',
    fileExtension: 'csv',
  },
  image: {
    renderStrategy: 'image',
    editable: false,
    livePreview: true,
    mimeType: 'image/*',
    fileExtension: 'png',
  },
  document: {
    renderStrategy: 'download',
    editable: false,
    livePreview: false,
    mimeType: 'application/octet-stream',
    fileExtension: 'bin',
  },
};

const MERMAID_PREFIXES = [
  'graph ',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram',
  'erDiagram',
  'journey',
  'gantt',
  'pie ',
  'flowchart ',
  'mindmap',
  'timeline',
  'gitGraph',
] as const;

function inferFromMimeType(mimeType?: string | null): ArtifactContentType | null {
  if (!mimeType) {
    return null;
  }

  if (mimeType === 'text/html') {
    return 'html';
  }
  if (mimeType === 'image/svg+xml') {
    return 'svg';
  }
  if (mimeType.startsWith('image/')) {
    return 'image';
  }
  if (mimeType === 'text/markdown') {
    return 'markdown';
  }
  if (mimeType === 'text/csv') {
    return 'csv';
  }

  return null;
}

function inferFromFileName(fileName?: string | null): ArtifactContentType | null {
  if (!fileName) {
    return null;
  }

  const normalized = fileName.trim().toLowerCase();
  if (normalized.endsWith('.html') || normalized.endsWith('.htm')) {
    return 'html';
  }
  if (normalized.endsWith('.svg')) {
    return 'svg';
  }
  if (normalized.endsWith('.tsx') || normalized.endsWith('.jsx')) {
    return 'react';
  }
  if (normalized.endsWith('.md') || normalized.endsWith('.markdown')) {
    return 'markdown';
  }
  if (normalized.endsWith('.csv')) {
    return 'csv';
  }
  if (normalized.endsWith('.mmd') || normalized.endsWith('.mermaid')) {
    return 'mermaid';
  }
  if (normalized.match(/\.(png|jpg|jpeg|gif|webp|bmp)$/)) {
    return 'image';
  }

  return null;
}

function looksLikeCsv(content: string): boolean {
  const lines = content
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2 || lines.length > 20) {
    return false;
  }
  const headerColumns = lines[0]?.split(',').length ?? 0;
  if (headerColumns < 2) {
    return false;
  }
  return lines.slice(1, 4).every((line) => line.split(',').length === headerColumns);
}

function looksLikeReact(content: string): boolean {
  const normalized = content.trim();
  return (
    /from ['"]react['"]/.test(normalized) ||
    /React\./.test(normalized) ||
    /export default function [A-Z]/.test(normalized) ||
    /return\s*\(<[A-Za-z]/.test(normalized)
  );
}

function looksLikeHtml(content: string): boolean {
  const normalized = content.trim().toLowerCase();
  return (
    normalized.startsWith('<!doctype html') ||
    normalized.startsWith('<html') ||
    normalized.includes('<body') ||
    normalized.includes('<head')
  );
}

function looksLikeMarkdown(content: string): boolean {
  const normalized = content.trim();
  return (
    /^#{1,6}\s+/m.test(normalized) ||
    /^[-*+]\s+/m.test(normalized) ||
    /```[\w-]*/.test(normalized) ||
    /\[[^\]]+\]\([^)]+\)/.test(normalized)
  );
}

function looksLikeMermaid(content: string): boolean {
  const normalized = content.trim();
  return MERMAID_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function detectArtifactContentType(input: {
  content: string;
  fileName?: string | null;
  mimeType?: string | null;
  hint?: ArtifactContentType | null;
}): ArtifactContentType {
  if (input.hint && ARTIFACT_CONTENT_TYPES.includes(input.hint)) {
    return input.hint;
  }

  const mimeMatch = inferFromMimeType(input.mimeType);
  if (mimeMatch) {
    return mimeMatch;
  }

  const fileNameMatch = inferFromFileName(input.fileName);
  if (fileNameMatch) {
    return fileNameMatch;
  }

  const content = input.content.trim();
  if (!content) {
    return 'document';
  }

  if (content.startsWith('<svg')) {
    return 'svg';
  }
  if (looksLikeHtml(content)) {
    return 'html';
  }
  if (looksLikeReact(content)) {
    return 'react';
  }
  if (looksLikeMermaid(content)) {
    return 'mermaid';
  }
  if (looksLikeCsv(content)) {
    return 'csv';
  }
  if (looksLikeMarkdown(content)) {
    return 'markdown';
  }

  return 'code';
}

export function buildArtifactPreviewSnippet(content: string, maxLength = 1200): string | undefined {
  const normalized = content.replace(/\0/g, '').trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}
…`
    : normalized;
}

export function computeArtifactLineDiff(
  beforeContent: string,
  afterContent: string,
): ArtifactLineChange[] {
  const beforeLines = beforeContent.split(/\r?\n/);
  const afterLines = afterContent.split(/\r?\n/);
  const maxLength = Math.max(beforeLines.length, afterLines.length);
  const changes: ArtifactLineChange[] = [];

  for (let index = 0; index < maxLength; index += 1) {
    const before = beforeLines[index];
    const after = afterLines[index];

    if (before === after) {
      continue;
    }

    if (before === undefined && after !== undefined) {
      changes.push({ lineNumber: index + 1, kind: 'added', after });
      continue;
    }

    if (before !== undefined && after === undefined) {
      changes.push({ lineNumber: index + 1, kind: 'removed', before });
      continue;
    }

    changes.push({ lineNumber: index + 1, kind: 'modified', before, after });
  }

  return changes;
}
