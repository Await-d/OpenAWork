import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FILE_ICON_THEME,
  FILE_ICON_THEMES,
  canonicalizeFolderName,
  isFileIconThemeId,
  resolveFileIcon,
  resolveFolderIcon,
} from './resolve-file-icon.js';
import type { MaterialIconManifest } from './types.js';

const MANIFEST: MaterialIconManifest = {
  file: 'file',
  folder: 'folder',
  folderExpanded: 'folder-open',
  rootFolder: 'folder-root',
  rootFolderExpanded: 'folder-root-open',
  fileExtensions: {
    ts: 'typescript',
    'bar.ts': 'composite-ts',
    png: 'image',
  },
  fileNames: {
    'package.json': 'npm',
    'readme.md': 'readme',
  },
  folderNames: {
    nodemodules: 'folder-node',
    tests: 'folder-test',
    src: 'folder-src',
  },
  folderNamesExpanded: {
    nodemodules: 'folder-node-open',
    tests: 'folder-test-open',
    src: 'folder-src-open',
  },
  light: {
    fileNames: { 'package.json': 'npm-light' },
    fileExtensions: { ts: 'typescript-light' },
    folderNames: { tests: 'folder-test-light' },
    folderNamesExpanded: { tests: 'folder-test-open-light' },
  },
};

describe('resolve file icon', () => {
  it('精确命中文件名优先于扩展名', () => {
    expect(resolveFileIcon({ name: 'package.json', manifest: MANIFEST })).toEqual({
      kind: 'material',
      iconId: 'npm',
    });
  });

  it('文件名小写回退命中', () => {
    expect(resolveFileIcon({ name: 'README.md', manifest: MANIFEST }).iconId).toBe('readme');
  });

  it('按扩展名命中', () => {
    expect(resolveFileIcon({ name: 'index.ts', manifest: MANIFEST }).iconId).toBe('typescript');
  });

  it('复合扩展名最长优先', () => {
    expect(resolveFileIcon({ name: 'index.bar.ts', manifest: MANIFEST }).iconId).toBe(
      'composite-ts',
    );
  });

  it('未知扩展名回退到清单通用文件图标', () => {
    expect(resolveFileIcon({ name: 'index.xyz', manifest: MANIFEST }).iconId).toBe('file');
    expect(resolveFileIcon({ name: 'no-extension', manifest: MANIFEST }).iconId).toBe('file');
  });

  it('命中的扩展名优先于通用图标而非文件名', () => {
    expect(resolveFileIcon({ name: 'logo.png', manifest: MANIFEST }).iconId).toBe('image');
  });

  it('亮色清单覆盖优先于主表', () => {
    expect(
      resolveFileIcon({ name: 'package.json', manifest: MANIFEST, mode: 'light' }).iconId,
    ).toBe('npm-light');
    expect(resolveFileIcon({ name: 'index.ts', manifest: MANIFEST, mode: 'light' }).iconId).toBe(
      'typescript-light',
    );
    expect(resolveFileIcon({ name: 'index.ts', manifest: MANIFEST, mode: 'dark' }).iconId).toBe(
      'typescript',
    );
  });
});

describe('resolve folder icon', () => {
  it('目录名规范化后命中（node_modules / __tests__）', () => {
    expect(resolveFolderIcon({ name: 'node_modules', manifest: MANIFEST })).toEqual({
      kind: 'material',
      iconId: 'folder-node',
      openIconId: 'folder-node-open',
    });
    expect(resolveFolderIcon({ name: '__tests__', manifest: MANIFEST }).iconId).toBe('folder-test');
    expect(resolveFolderIcon({ name: '__tests__', manifest: MANIFEST }).openIconId).toBe(
      'folder-test-open',
    );
  });

  it('未知目录回退到通用目录图标', () => {
    expect(resolveFolderIcon({ name: 'weird-folder', manifest: MANIFEST })).toEqual({
      kind: 'material',
      iconId: 'folder',
      openIconId: 'folder-open',
    });
  });

  it('根目录默认使用 rootFolder / rootFolderExpanded', () => {
    expect(resolveFolderIcon({ name: 'weird-folder', isRoot: true, manifest: MANIFEST })).toEqual({
      kind: 'material',
      iconId: 'folder-root',
      openIconId: 'folder-root-open',
    });
  });

  it('根目录已命中具体目录名时仍以命中为准', () => {
    const resolved = resolveFolderIcon({ name: 'src', isRoot: true, manifest: MANIFEST });
    expect(resolved.iconId).toBe('folder-src');
    expect(resolved.openIconId).toBe('folder-src-open');
  });

  it('亮色清单覆盖优先于主表', () => {
    const resolved = resolveFolderIcon({ name: '__tests__', manifest: MANIFEST, mode: 'light' });
    expect(resolved.iconId).toBe('folder-test-light');
    expect(resolved.openIconId).toBe('folder-test-open-light');
  });
});

describe('file icon theme helpers', () => {
  it('canonicalizeFolderName 转小写并去除非字母数字', () => {
    expect(canonicalizeFolderName('node_modules')).toBe('nodemodules');
    expect(canonicalizeFolderName('__tests__')).toBe('tests');
    expect(canonicalizeFolderName('.Git')).toBe('git');
  });

  it('isFileIconThemeId 只接受已知主题', () => {
    expect(isFileIconThemeId('material')).toBe(true);
    expect(isFileIconThemeId('minimal')).toBe(true);
    expect(isFileIconThemeId('unknown')).toBe(false);
    expect(isFileIconThemeId(undefined)).toBe(false);
  });

  it('主题表包含 material 与 minimal，默认 material', () => {
    expect(FILE_ICON_THEMES.map((theme) => theme.id)).toEqual(['material', 'minimal']);
    expect(DEFAULT_FILE_ICON_THEME).toBe('material');
  });
});
