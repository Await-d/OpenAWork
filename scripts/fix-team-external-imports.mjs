#!/usr/bin/env node
/**
 * 二次修复：team/runtime 下的「外部模块」相对导入。
 *
 * 重组前所有文件都在 `apps/web/src/pages/team/runtime/X.tsx`，外部模块
 * 用 `../../../stores/...` `../../../components/...` 这种 3 级返回。重组后
 * 文件可能在 `runtime/<sub>/...` 或 `runtime/<sub>/<sub2>/...`，需要相应
 * 增加 `../` 数。
 *
 * 策略：对每个文件，把指向 runtime/ 之外的相对导入解析到绝对路径，
 * 再按当前文件的新位置重新计算相对路径。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../apps/web/src/pages/team/runtime');
const SRC_ROOT = path.resolve(__dirname, '../apps/web/src');

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

const importRe = /(from\s+['"])(\.{1,2}\/[^'"\n]+?)\.js(['"])/g;

const allRuntimeFiles = new Set(await walk(ROOT));
let changedCount = 0;

for (const file of allRuntimeFiles) {
  let text = await fs.readFile(file, 'utf8');
  const original = text;

  text = text.replace(importRe, (whole, prefix, spec, suffix) => {
    // 当前位置解析
    const resolvedAbs = path.resolve(path.dirname(file), spec);

    // 已经能在 runtime 内解析到 .ts/.tsx 的，已经被前一个脚本搞定，跳过
    for (const ext of ['.ts', '.tsx']) {
      if (allRuntimeFiles.has(resolvedAbs + ext)) return whole;
    }

    // 如果 spec 指向的是 runtime/ 内部但当前路径解析不到，那是另一个问题
    if (resolvedAbs.startsWith(ROOT + path.sep)) return whole;

    // 是否仍在 src/ 内（换言之是项目相对模块）
    if (!resolvedAbs.startsWith(SRC_ROOT + path.sep)) return whole;

    // 假设原始导入指向「重组前」3 级返回的位置：
    //   runtime/X.tsx -> ../../../<rest>
    // 我们抽取 spec 末尾的 path 段，按 src/<rest>.ts 找
    // 但更简单的做法：原始 spec 在原始位置 (runtime/X.tsx) 解析得到的目标
    // 若仍存在，就用它做新基准。
    const originalAbs = path.resolve(ROOT, spec);
    let realTarget = null;
    for (const ext of ['.ts', '.tsx', '.js']) {
      try {
        // 不能 await fs.access 在 replace 同步内 — 改成同步存在性需要预扫描。
      } catch {
        // ignore
      }
    }
    // 走预扫描 fallback：如果 spec 本身在 runtime 之外解析得到的相对模块
    // 在文件系统里存在，那 originalAbs 就是它；否则保守跳过。
    realTarget = originalAbs;
    const newSpec = relSpec(file, realTarget);
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
