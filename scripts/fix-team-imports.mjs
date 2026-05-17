#!/usr/bin/env node
/**
 * 一次性脚本：team/runtime 重组后批量修复同级旧 import。
 *
 * 工作机制：
 *   1. 扫描 runtime/ 下所有 .ts/.tsx 文件，建立 stem → 新路径表
 *   2. 对每个文件中的 `from './X.js'` / `from '../X.js'` 等相对导入：
 *      - 如果按当前路径解析得到的目标存在，保持不动
 *      - 否则按 stem 在新表里查到目标，改为正确的相对路径
 *
 * 仅处理 runtime/ 内部相对导入，对外部模块（'../../stores/...' 等）一律不动。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../apps/web/src/pages/team/runtime');

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
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

const allFiles = await walk(ROOT);

// stem (basename w/o extension) → absolute path
const stemToPath = new Map();
for (const file of allFiles) {
  const base = path.basename(file).replace(/\.(ts|tsx)$/, '');
  if (stemToPath.has(base) && stemToPath.get(base) !== file) {
    console.error(`Stem clash: ${base}\n  ${stemToPath.get(base)}\n  ${file}`);
    process.exit(1);
  }
  stemToPath.set(base, file);
}

const importRe = /(from\s+['"])(\.{1,2}\/[^'"\n]+?)\.js(['"])/g;
let changedCount = 0;

for (const file of allFiles) {
  let text = await fs.readFile(file, 'utf8');
  const original = text;
  text = text.replace(importRe, (whole, prefix, spec, suffix) => {
    const resolvedAbs = path.resolve(path.dirname(file), spec);
    // 如果目标存在（任意 .ts/.tsx），保持不动
    for (const ext of ['.ts', '.tsx']) {
      try {
        // existsSync 同步太啰嗦；直接在 finalAllFiles 集合里查
        if (allFiles.includes(resolvedAbs + ext)) return whole;
      } catch {
        // ignore
      }
    }
    const stem = path.basename(resolvedAbs);
    const newAbs = stemToPath.get(stem);
    if (!newAbs) {
      // 不在 runtime/ 内部，保持不动（外部 store/component 等）
      return whole;
    }
    const newSpec = relSpec(file, newAbs.replace(/\.(ts|tsx)$/, ''));
    return `${prefix}${newSpec}.js${suffix}`;
  });
  if (text !== original) {
    await fs.writeFile(file, text, 'utf8');
    changedCount++;
    console.log('fixed:', path.relative(process.cwd(), file));
  }
}

console.log(`\nTotal: ${changedCount} files updated`);
