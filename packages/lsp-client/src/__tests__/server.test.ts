import { describe, it, expect } from 'vitest';
import {
  NearestRoot,
  findServerForFile,
  TypescriptServer,
  GoplsServer,
  PyrightServer,
  JsonServer,
  HtmlServer,
  CssServer,
  YamlServer,
  DockerfileServer,
  ShellscriptServer,
  RustAnalyzerServer,
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

  it('returns JsonServer for .json files', () => {
    const server = findServerForFile('/config/settings.json');
    expect(server?.id).toBe('json');
  });

  it('returns HtmlServer for .html files', () => {
    const server = findServerForFile('/web/index.html');
    expect(server?.id).toBe('html');
  });

  it('returns CssServer for .css files', () => {
    const server = findServerForFile('/web/styles.css');
    expect(server?.id).toBe('css');
  });

  it('returns YamlServer for .yaml files', () => {
    const server = findServerForFile('/config/app.yaml');
    expect(server?.id).toBe('yaml');
  });

  it('returns DockerfileServer for Dockerfile by filename', () => {
    const server = findServerForFile('/workspace/services/api/Dockerfile');
    expect(server?.id).toBe('dockerfile');
  });

  it('returns ShellscriptServer for .sh files', () => {
    const server = findServerForFile('/scripts/run.sh');
    expect(server?.id).toBe('shellscript');
  });

  it('returns ShellscriptServer for .bash files', () => {
    const server = findServerForFile('/scripts/run.bash');
    expect(server?.id).toBe('shellscript');
  });

  it('returns ShellscriptServer for .zsh files', () => {
    const server = findServerForFile('/scripts/run.zsh');
    expect(server?.id).toBe('shellscript');
  });

  it('returns RustAnalyzerServer for .rs files', () => {
    const server = findServerForFile('/src/lib.rs');
    expect(server?.id).toBe('rust-analyzer');
  });

  it('returns undefined for unsupported extension', () => {
    const server = findServerForFile('/src/image.png');
    expect(server).toBeUndefined();
  });

  it('ALL_SERVERS contains typescript, gopls, pyright, json, html, css, yaml, dockerfile, shellscript, rust-analyzer', () => {
    const ids = ALL_SERVERS.map((s) => s.id);
    expect(ids).toContain('typescript');
    expect(ids).toContain('gopls');
    expect(ids).toContain('pyright');
    expect(ids).toContain('json');
    expect(ids).toContain('html');
    expect(ids).toContain('css');
    expect(ids).toContain('yaml');
    expect(ids).toContain('dockerfile');
    expect(ids).toContain('shellscript');
    expect(ids).toContain('rust-analyzer');
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

  it('JsonServer extensions include .json and .jsonc', () => {
    expect(JsonServer.extensions).toContain('.json');
    expect(JsonServer.extensions).toContain('.jsonc');
  });

  it('HtmlServer extensions include .html', () => {
    expect(HtmlServer.extensions).toContain('.html');
  });

  it('CssServer extensions include .css and .scss', () => {
    expect(CssServer.extensions).toContain('.css');
    expect(CssServer.extensions).toContain('.scss');
  });

  it('YamlServer extensions include .yaml and .yml', () => {
    expect(YamlServer.extensions).toContain('.yaml');
    expect(YamlServer.extensions).toContain('.yml');
  });

  it('DockerfileServer extensions include dockerfile filename token', () => {
    expect(DockerfileServer.extensions).toContain('dockerfile');
  });

  it('ShellscriptServer extensions include .sh, .bash, and .zsh', () => {
    expect(ShellscriptServer.extensions).toContain('.sh');
    expect(ShellscriptServer.extensions).toContain('.bash');
    expect(ShellscriptServer.extensions).toContain('.zsh');
  });

  it('RustAnalyzerServer extensions include .rs', () => {
    expect(RustAnalyzerServer.extensions).toContain('.rs');
  });
});
