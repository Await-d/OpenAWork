import { describe, it, expect } from 'vitest';
import { getLanguageId, LANGUAGE_EXTENSIONS } from '../language.js';

describe('getLanguageId', () => {
  it('maps TypeScript extensions correctly', () => {
    expect(getLanguageId('/src/foo.ts')).toBe('typescript');
    expect(getLanguageId('/src/foo.tsx')).toBe('typescriptreact');
    expect(getLanguageId('/src/foo.mts')).toBe('typescript');
    expect(getLanguageId('/src/foo.cts')).toBe('typescript');
  });

  it('maps JavaScript extensions correctly', () => {
    expect(getLanguageId('/src/foo.js')).toBe('javascript');
    expect(getLanguageId('/src/foo.jsx')).toBe('javascriptreact');
    expect(getLanguageId('/src/foo.mjs')).toBe('javascript');
    expect(getLanguageId('/src/foo.cjs')).toBe('javascript');
  });

  it('maps Go extension', () => {
    expect(getLanguageId('/src/main.go')).toBe('go');
  });

  it('maps Python extensions', () => {
    expect(getLanguageId('/src/main.py')).toBe('python');
    expect(getLanguageId('/src/types.pyi')).toBe('python');
  });

  it('maps Rust extension', () => {
    expect(getLanguageId('/src/main.rs')).toBe('rust');
  });

  it('maps JSON and YAML', () => {
    expect(getLanguageId('/config.json')).toBe('json');
    expect(getLanguageId('/config.yaml')).toBe('yaml');
    expect(getLanguageId('/config.yml')).toBe('yaml');
  });

  it('maps CSS family', () => {
    expect(getLanguageId('/styles.css')).toBe('css');
    expect(getLanguageId('/styles.scss')).toBe('scss');
    expect(getLanguageId('/styles.less')).toBe('less');
  });

  it('maps Markdown', () => {
    expect(getLanguageId('/README.md')).toBe('markdown');
    expect(getLanguageId('/doc.mdx')).toBe('mdx');
  });

  it('returns plaintext for unknown extension', () => {
    expect(getLanguageId('/file.unknownxyz')).toBe('plaintext');
  });

  it('recognizes Dockerfile by filename', () => {
    expect(getLanguageId('/path/to/Dockerfile')).toBe('dockerfile');
    expect(getLanguageId('/Dockerfile')).toBe('dockerfile');
  });

  it('recognizes Makefile by filename', () => {
    expect(getLanguageId('/Makefile')).toBe('makefile');
  });

  it('LANGUAGE_EXTENSIONS has more than 50 entries', () => {
    expect(Object.keys(LANGUAGE_EXTENSIONS).length).toBeGreaterThan(50);
  });
});
