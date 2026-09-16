/**
 * vite-plugin-file-icons 的 buildMaterialIconManifest 纯函数回归测试。
 *
 * 运行：node --test scripts/build/vite-plugin-file-icons.test.mjs
 *
 * 覆盖：
 *   - iconPath 与 iconId 不一致时按文件名反推
 *   - 目录名变体规范化收敛 / 空规范化丢弃
 *   - 规范化冲突抛错（含冲突 key）
 *   - 关联引用不存在 iconId 抛错
 *   - fileNames 的 key 原样保留（不 lower）
 *   - 根级 file/folder 等走各自兜底
 *   - 键排序稳定（同输入输出字节一致）
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMaterialIconManifest } from './vite-plugin-file-icons.mjs';

/** 手写 fixture：只补 5 个根级兜底图标，不读 node_modules，保证离线可跑。 */
function makeFixture(overrides = {}) {
  const { iconDefinitions, ...rest } = overrides;
  return {
    iconDefinitions: {
      file: { iconPath: './../icons/file.svg' },
      folder: { iconPath: './../icons/folder.svg' },
      'folder-open': { iconPath: './../icons/folder-open.svg' },
      'folder-root': { iconPath: './../icons/folder-root.svg' },
      'folder-root-open': { iconPath: './../icons/folder-root-open.svg' },
      ...iconDefinitions,
    },
    ...rest,
  };
}

test('iconPath 与 iconId 不一致时，清单值取文件名而非 iconId', () => {
  const manifest = buildMaterialIconManifest(
    makeFixture({
      iconDefinitions: {
        'angular-component': { iconPath: './../icons/angular-component.clone.svg' },
      },
      fileExtensions: { ng: 'angular-component' },
    }),
  );

  assert.equal(manifest.fileExtensions.ng, 'angular-component.clone');
});

test('目录名变体规范化收敛到同一 key，空规范化被丢弃', () => {
  const manifest = buildMaterialIconManifest(
    makeFixture({
      iconDefinitions: { 'rust-icon': { iconPath: './../icons/rust.svg' } },
      folderNames: {
        rust: 'rust-icon',
        _rust: 'rust-icon',
        '-rust': 'rust-icon',
        __rust__: 'rust-icon',
        ___: 'rust-icon',
      },
    }),
  );

  assert.deepEqual(manifest.folderNames, { rust: 'rust' });
});

test('规范化后同名但图标不同时抛错，错误信息含冲突 key', () => {
  assert.throws(
    () =>
      buildMaterialIconManifest(
        makeFixture({
          iconDefinitions: {
            'rust-icon': { iconPath: './../icons/rust.svg' },
            'rust-alt': { iconPath: './../icons/rust-alt.svg' },
          },
          folderNames: { rust: 'rust-icon', _rust: 'rust-alt' },
        }),
      ),
    /规范化冲突[\s\S]*rust/,
  );
});

test('关联引用了不存在的 iconId 时抛错，错误信息含该 id', () => {
  assert.throws(
    () =>
      buildMaterialIconManifest(makeFixture({ fileNames: { '.pug-lintrc.js': 'missing-icon' } })),
    /missing-icon/,
  );
});

test('fileNames 的 key 原样保留，不做小写化', () => {
  const manifest = buildMaterialIconManifest(
    makeFixture({
      iconDefinitions: {
        pug: { iconPath: './../icons/pug.svg' },
        babel: { iconPath: './../icons/babel.svg' },
      },
      fileNames: { '.pug-lintrc.js': 'pug', '.Babelrc.js': 'babel' },
    }),
  );

  assert.deepEqual(manifest.fileNames, { '.Babelrc.js': 'babel', '.pug-lintrc.js': 'pug' });
});

test('根级 file/folder 等缺失时走到各自兜底值', () => {
  const manifest = buildMaterialIconManifest({
    iconDefinitions: {
      file: { iconPath: './../icons/file.svg' },
      folder: { iconPath: './../icons/folder.svg' },
      'folder-open': { iconPath: './../icons/folder-open.svg' },
      'folder-root': { iconPath: './../icons/folder-root.svg' },
      'folder-root-open': { iconPath: './../icons/folder-root-open.svg' },
    },
  });

  assert.equal(manifest.file, 'file');
  assert.equal(manifest.folder, 'folder');
  assert.equal(manifest.folderExpanded, 'folder-open');
  assert.equal(manifest.rootFolder, 'folder-root');
  assert.equal(manifest.rootFolderExpanded, 'folder-root-open');
});

test('同一输入两次调用输出一致，键序相反时输出仍一致', () => {
  const input = makeFixture({
    iconDefinitions: {
      a: { iconPath: './../icons/a.svg' },
      b: { iconPath: './../icons/b.svg' },
    },
    fileExtensions: { b: 'b', a: 'a' },
    folderNames: { zebra: 'a', apple: 'b' },
  });
  const reordered = makeFixture({
    iconDefinitions: {
      b: { iconPath: './../icons/b.svg' },
      a: { iconPath: './../icons/a.svg' },
    },
    fileExtensions: { a: 'a', b: 'b' },
    folderNames: { apple: 'b', zebra: 'a' },
  });

  const first = JSON.stringify(buildMaterialIconManifest(input));
  assert.equal(first, JSON.stringify(buildMaterialIconManifest(input)));
  assert.equal(first, JSON.stringify(buildMaterialIconManifest(reordered)));
});
