#!/usr/bin/env node
/**
 * 通用修复：team/runtime 重组后任何相对导入若不能在文件系统解析到目标，
 * 就尝试在 apps/web/src 全树里通过 basename 反查，重写为正确的相对路径。
 *
 * 这个脚本是幂等的：已经能正确解析的导入一律不动。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(__dirname, '../apps/web/src');
const RUNTIME_ROOT = path.resolve(__dirname, '../apps/web/src/pages/team/runtime');

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function relSpec(fromFile, targetAbs) {
  let rel = path.relative(path.dirname(fromFile), targetAbs);
  rel = toPosix(rel);
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

const allFiles = await walk(SRC_ROOT);
const allFilesSet = new Set(allFiles);

// basename → absolute path (collisions across multiple dirs require disambiguation)
const stemToPaths = new Map();
for (const file of allFiles) {
  const base = path.basename(file).replace(/\.(ts|tsx)$/, '');
  if (!stemToPaths.has(base)) stemToPaths.set(base, []);
  stemToPaths.get(base).push(file);
}

// 处理 runtime/ 下的所有文件 + 引用 runtime 模块的页面级文件
const targetFiles = allFiles.filter(
  (f) =>
    f.startsWith(RUNTIME_ROOT + path.sep) ||
    /\/apps\/web\/src\/pages\/Team(?:Page|TemplatesPage)?(V2)?\.tsx$/.test(f) ||
    f === path.resolve(SRC_ROOT, 'pages/TeamPage.tsx') ||
    f === path.resolve(SRC_ROOT, 'pages/TeamPageV2.tsx') ||
    f === path.resolve(SRC_ROOT, 'pages/TeamTemplatesPage.tsx'),
);

const importRe = /(from\s+['"])(\.{1,2}\/[^'"\n]+?)\.js(['"])/g;

let changedCount = 0;
const ambiguous = [];

for (const file of targetFiles) {
  let text = await fs.readFile(file, 'utf8');
  const original = text;

  text = text.replace(importRe, (whole, prefix, spec, suffix) => {
    const resolvedAbs = path.resolve(path.dirname(file), spec);

    // 已能正确解析？保持
    for (const ext of ['.ts', '.tsx']) {
      if (allFilesSet.has(resolvedAbs + ext)) return whole;
    }

    // 通过 basename 反查
    const stem = path.basename(resolvedAbs);
    const candidates = stemToPaths.get(stem);
    if (!candidates || candidates.length === 0) return whole;
    if (candidates.length > 1) {
      ambiguous.push({ file, spec, candidates });
      return whole;
    }
    const target = candidates[0];
    const newSpec = relSpec(file, target.replace(/\.(ts|tsx)$/, ''));
    if (newSpec === spec) return whole;
    return `${prefix}${newSpec}.js${suffix}`;
  });

  if (text !== original) {
    await fs.writeFile(file, text, 'utf8');
    changedCount++;
    console.log('fixed:', path.relative(process.cwd(), file));
  }
}

console.log(`\nTotal: ${changedCount} files updated`);
if (ambiguous.length > 0) {
  console.log(`\nAmbiguous (${ambiguous.length}) — need manual resolution:`);
  for (const item of ambiguous) {
    console.log(`  ${path.relative(process.cwd(), item.file)}`);
    console.log(`    spec: '${item.spec}.js'`);
    for (const c of item.candidates) {
      console.log(`      candidate: ${path.relative(process.cwd(), c)}`);
    }
  }
}
