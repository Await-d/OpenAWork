#!/usr/bin/env node
/**
 * 从 templates/souls/*.md 生成 soul-defaults.ts 中的内联 SOUL 字符串。
 *
 * 用法：node scripts/sync-souls.mjs
 *
 * 流程：
 *   1. 读取 templates/souls/{reception,pm1,pm2,executor,reviewer}.md
 *   2. 解析 frontmatter 获取 displayName / summary
 *   3. 生成 soul-defaults.ts 中的 RECEPTION_SOUL / PM1_SOUL / ... 常量
 *   4. 写回 soul-defaults.ts（只替换 SOUL 常量定义部分，保留其余代码不变）
 *
 * 设计参考：spec-kit 的模板系统——.md 文件是权威源，运行时载体是生成的代码。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', 'src', 'team-phase-a-content', 'templates', 'souls');
const TARGET_FILE = join(__dirname, '..', 'src', 'team-phase-a-content', 'soul-defaults.ts');

const ROLES = ['reception', 'pm1', 'pm2', 'executor', 'reviewer'];

/**
 * 从 .md 文件内容中解析 frontmatter 和正文。
 * 简单解析：提取 --- 之间的 YAML frontmatter，其余为正文。
 */
function parseSoulFile(content) {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!fmMatch) {
    throw new Error('无法解析 frontmatter');
  }
  const frontmatter = fmMatch[1];
  const body = fmMatch[2];

  // 从 frontmatter 中提取简单字段（不使用 YAML 解析器，保持零依赖）
  const identity = frontmatter.match(/^identity:\s*(.+)$/m)?.[1] ?? '';
  const summary = frontmatter.match(/^summary:\s*(.+)$/m)?.[1] ?? '';

  return {
    frontmatter,
    body,
    fullContent: content.trim(),
    identity,
    summary,
  };
}

/**
 * 读取 .md 文件并生成 DefaultSoul 常量的 TS 代码片段。
 */
function generateSoulConstant(roleName) {
  const mdPath = join(TEMPLATES_DIR, `${roleName}.md`);
  const raw = readFileSync(mdPath, 'utf-8');
  // 统一行尾为 \n，避免 Windows \r\n 导致每次同步都检测到"变化"
  const normalizedRaw = raw.replace(/\r\n/g, '\n');
  const parsed = parseSoulFile(normalizedRaw);

  // displayName 从 frontmatter 的 identity 第一句提取，或用角色名映射
  const displayNames = {
    reception: '接待 · Reception',
    pm1: '任务规划 · PM1',
    pm2: '开发管控 · PM2',
    executor: '执行 · Executor',
    reviewer: '评审 · Reviewer',
  };

  const summaries = {
    reception: '把人类原始诉求改写成可执行的需求语言，并守住"先听清再分派"的节奏。',
    pm1: '把接待传来的目标拆解为可分派的任务清单，并守住"先想清楚再开工"的节奏。',
    pm2: '把任务清单分派给开发团队（执行者 / 评审者），并守住"过程透明 + 风险前置"的节奏。',
    executor: '在 PM2 分派的任务上做出可演示的产物，并守住"小步可逆 + 透明可观察"的节奏。',
    reviewer: '为执行者交付的产物把守质量门，并守住"对事不对人 + 给可执行反馈"的节奏。',
  };

  // 转义模板字符串中的反引号和 ${}
  const escapedContent = parsed.fullContent
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');

  const constName = `${roleName.toUpperCase()}_SOUL`;

  return `const ${constName}: DefaultSoul = {
  roleLayer: '${roleName}',
  key: 'default',
  displayName: '${displayNames[roleName]}',
  summary: '${summaries[roleName]}',
  soulMd: \`${escapedContent}\`,
};`;
}

// 主流程
console.log('同步 SOUL 模板...');
console.log(`  模板目录: ${TEMPLATES_DIR}`);
console.log(`  目标文件: ${TARGET_FILE}`);

const originalContent = readFileSync(TARGET_FILE, 'utf-8');
let targetContent = originalContent;
let changed = false;

for (const role of ROLES) {
  const newConstant = generateSoulConstant(role);
  const constName = `${role.toUpperCase()}_SOUL`;

  // 匹配现有的常量定义（从 `const XXX_SOUL: DefaultSoul = {` 到 `};`）
  const regex = new RegExp(
    `const ${constName}: DefaultSoul = \\{[\\s\\S]*?^\\};`,
    'm',
  );

  if (!regex.test(targetContent)) {
    console.error(`  ✗ 无法找到 ${constName} 的现有定义`);
    process.exit(1);
  }

  // 检查是否有变化（统一行尾后再比较，避免 Windows \r\n vs \n 差异）
  const existingMatch = targetContent.match(regex);
  if (existingMatch) {
    const normalized = existingMatch[0].replace(/\r\n/g, '\n');
    if (normalized !== newConstant) {
      targetContent = targetContent.replace(regex, newConstant);
      console.log(`  ✓ 已同步 ${constName}（内容有变化）`);
      changed = true;
    } else {
      console.log(`  ✓ ${constName} 无变化，跳过`);
    }
  } else {
    console.error(`  ✗ 无法匹配 ${constName}`);
    process.exit(1);
  }
}

// 只在内容有变化时递增版本号
if (changed) {
  const versionMatch = targetContent.match(/export const DEFAULT_SOUL_VERSION = (\d+);/);
  if (versionMatch) {
    const oldVersion = parseInt(versionMatch[1], 10);
    const newVersion = oldVersion + 1;
    targetContent = targetContent.replace(
      /export const DEFAULT_SOUL_VERSION = \d+;/,
      `export const DEFAULT_SOUL_VERSION = ${newVersion};`,
    );
    console.log(`  ✓ 版本号 ${oldVersion} → ${newVersion}`);
  }

  writeFileSync(TARGET_FILE, targetContent, 'utf-8');
  console.log('同步完成（有变更已写入）。');
} else {
  console.log('同步完成（无变更，不写入）。');
}
