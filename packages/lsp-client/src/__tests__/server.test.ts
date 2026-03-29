import { describe, it, expect } from 'vitest';
import {
  NearestRoot,
  findServerForFile,
  TypescriptServer,
  GoplsServer,
  PyrightServer,
  ALL_SERVERS,
} from '../server.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { promises as fs } from 'fs';

describe('NearestRoot', () => {
  it('finds root with package.json', async () => {
    const tmp = await fs.mkdtemp(join(tmpdir(), 'lsp-test-'));
    const src = join(tmp, 'src');
    await fs.mkdir(src);
    await fs.writeFile(join(tmp, 'package.json'), '{}');
    const rootFn = NearestRoot(['package.json']);
    const result = await rootFn(join(src, 'index.ts'));
    expect(result).toBe(tmp);
    await fs.rm(tmp, { recursive: true });
  });

  it('returns undefined when no matching file found', async () => {
    const tmp = await fs.mkdtemp(join(tmpdir(), 'lsp-test-'));
    const rootFn = NearestRoot(['nonexistent-marker-file.xyz']);
    const result = await rootFn(join(tmp, 'src', 'index.ts'));
    expect(result).toBeUndefined();
    await fs.rm(tmp, { recursive: true });
  });

  it('excludes when exclude pattern file is found', async () => {
    const tmp = await fs.mkdtemp(join(tmpdir(), 'lsp-test-'));
    const sub = join(tmp, 'sub');
    await fs.mkdir(sub);
    await fs.writeFile(join(tmp, 'package.json'), '{}');
    await fs.writeFile(join(sub, 'deno.json'), '{}');
    const rootFn = NearestRoot(['package.json'], ['deno.json']);
    const result = await rootFn(join(sub, 'index.ts'));
    expect(result).toBeUndefined();
    await fs.rm(tmp, { recursive: true });
  });
});

describe('findServerForFile', () => {
  it('returns TypescriptServer for .ts files', () => {
    const server = findServerForFile('/src/index.ts');
    expect(server?.id).toBe('typescript');
  });

  it('returns TypescriptServer for .tsx files', () => {
    const server = findServerForFile('/src/App.tsx');
    expect(server?.id).toBe('typescript');
  });

  it('returns GoplsServer for .go files', () => {
    const server = findServerForFile('/src/main.go');
    expect(server?.id).toBe('gopls');
  });

  it('returns PyrightServer for .py files', () => {
    const server = findServerForFile('/src/main.py');
    expect(server?.id).toBe('pyright');
  });

  it('returns undefined for unsupported extension', () => {
    const server = findServerForFile('/src/image.png');
    expect(server).toBeUndefined();
  });

  it('ALL_SERVERS contains typescript, gopls, pyright', () => {
    const ids = ALL_SERVERS.map((s) => s.id);
    expect(ids).toContain('typescript');
    expect(ids).toContain('gopls');
    expect(ids).toContain('pyright');
  });

  it('TypescriptServer extensions include .js and .jsx', () => {
    expect(TypescriptServer.extensions).toContain('.js');
    expect(TypescriptServer.extensions).toContain('.jsx');
  });

  it('GoplsServer extensions include .go', () => {
    expect(GoplsServer.extensions).toContain('.go');
  });

  it('PyrightServer extensions include .py and .pyi', () => {
    expect(PyrightServer.extensions).toContain('.py');
    expect(PyrightServer.extensions).toContain('.pyi');
  });
});
