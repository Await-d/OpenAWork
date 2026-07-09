import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ParsedMarkdownDocument {
  readonly frontmatter: Readonly<Record<string, string>>;
  readonly body: string;
}

const resourcesRootUrl = new URL('../resources/', import.meta.url);

export function resourcePath(...segments: readonly string[]): string {
  return fileURLToPath(resourceUrl(...segments));
}

export function resourceUrl(...segments: readonly string[]): URL {
  const relativePath = segments.join('/');
  return new URL(relativePath, resourcesRootUrl);
}

export function readTextResource(...segments: readonly string[]): string {
  return readFileSync(resourcePath(...segments), 'utf8')
    .replace(/\r\n/g, '\n')
    .trim();
}

export function readMarkdownDocument(path: string): ParsedMarkdownDocument {
  const source = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  const lines = source.split('\n');
  if (lines[0] !== '---') {
    return { frontmatter: {}, body: source.trim() };
  }
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (closingIndex < 0) {
    return { frontmatter: {}, body: source.trim() };
  }
  return {
    frontmatter: parseFrontmatter(lines.slice(1, closingIndex)),
    body: lines
      .slice(closingIndex + 1)
      .join('\n')
      .trim(),
  };
}

export function parseFrontmatter(lines: readonly string[]): Readonly<Record<string, string>> {
  const fields: Record<string, string> = {};
  for (const line of lines) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = stripYamlScalar(line.slice(separatorIndex + 1));
    fields[key] = value;
  }
  return fields;
}

export function parseCsvList(value: string | undefined): readonly string[] {
  if (!value) return [];
  return Array.from(
    new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

export function parseInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return undefined;
  return parsed;
}

export function readJsonRecord(path: string): Readonly<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isReadonlyRecord(parsed)) {
    return {};
  }
  return parsed;
}

export function listFilesRecursive(rootPath: string, prefix = ''): readonly string[] {
  return readdirSync(rootPath, { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        return [...listFilesRecursive(join(rootPath, entry.name), relativePath)];
      }
      return [relativePath];
    })
    .sort();
}

export function toTitle(value: string): string {
  return value
    .split('-')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function isReadonlyRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stripYamlScalar(value: string): string {
  const trimmed = value.trim();
  const first = trimmed[0];
  if ((first === "'" || first === '"') && trimmed.endsWith(first)) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
